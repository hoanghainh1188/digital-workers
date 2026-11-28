import type { Provider } from '@dw/billing';
import {
  type ChannelAdapter,
  type ChannelTarget,
  type IntakeWorker,
  readIntake,
} from '@dw/channels';
import {
  buildSystemPrompt,
  type CoalesceWindow,
  type NoticeKind,
  noticeText,
  type TaskLimits,
} from '@dw/core';
import {
  claimTask,
  closeWindowIfDue,
  type Database,
  databaseNow,
  finishTask,
  heartbeat,
  lockConversation,
  nextRunnable,
  type StopReason,
  type TaskRow,
  taskById,
  tasksNeedingAttention,
  withCompany,
} from '@dw/db';
import type { TaskJob, TaskQueue } from '@dw/db/queue';
import type { Gateway } from '@dw/llm';
import { loadTaskContext } from './runtime/context.ts';
import { type LoopLogger, runLoop } from './runtime/loop.ts';
import { toModelMessages } from './runtime/messages.ts';
import { skillToolSet } from './runtime/skill-tools.ts';

export interface TaskHandlerDeps {
  readonly database: Pick<Database, 'db' | 'pool'>;
  readonly gateway: Gateway;
  readonly channel: ChannelAdapter;
  readonly queue: TaskQueue;
  readonly model: { readonly provider: Provider; readonly id: string };
  readonly limits: TaskLimits;
  readonly window: CoalesceWindow;
  readonly logger: LoopLogger;
  readonly onBudgetExhausted?: (companyId: string, worker: IntakeWorker) => Promise<void>;
  /** Heartbeat while a model call is in flight (design D9). Default 15 s. */
  readonly heartbeatMs?: number;
  /** Reaper thresholds (design D9, 0.2 #132, #137). */
  readonly lostAfterSeconds?: number;
  readonly orphanAfterSeconds?: number;
  readonly now?: () => number;
}

export interface TaskHandlers {
  readonly start: (job: TaskJob) => Promise<void>;
  readonly run: (job: TaskJob) => Promise<void>;
  readonly reap: () => Promise<void>;
}

/** Reason a Task is cancelled when the start-time re-check fails (design D5). */
const CANCEL_REASON: Readonly<Record<NoticeKind, StopReason>> = {
  worker_suspended: 'worker_suspended',
  worker_offboarded: 'worker_offboarded',
  credit_exhausted: 'credit_exhausted',
  budget_exhausted: 'budget_exhausted',
  no_access: 'no_access',
  max_steps: 'max_steps',
  max_seconds: 'max_seconds',
  max_charge: 'max_charge',
  credit_exhausted_midway: 'credit_exhausted',
  runner_lost: 'runner_lost',
  error: 'error',
};

export function createTaskHandlers(deps: TaskHandlerDeps): TaskHandlers {
  const now = deps.now ?? Date.now;
  const heartbeatMs = deps.heartbeatMs ?? 15_000;

  const target = (task: TaskRow): ChannelTarget => ({
    kind: deps.channel.kind,
    companyId: task.companyId,
    workerId: task.workerId,
    chatExternalId: task.conversationId ?? '',
  });

  /** Sends the next queued Task of the conversation, if it may start now (design D2). */
  async function dispatchNext(companyId: string, conversationId: string | null): Promise<void> {
    const next = await withCompany(deps.database, companyId, (tx) =>
      nextRunnable(tx, conversationId),
    );
    if (next) await deps.queue.sendRun({ companyId, taskId: next });
  }

  async function start(job: TaskJob): Promise<void> {
    const outcome = await withCompany(deps.database, job.companyId, async (tx) => {
      const task = await taskById(tx, job.taskId);
      if (!task?.conversationId) return { kind: 'not_collecting' } as const;
      await lockConversation(tx, task.conversationId);
      return closeWindowIfDue(tx, job.taskId, deps.window);
    });
    if (outcome.kind === 'wait') await deps.queue.sendStart(job, outcome.ms);
    if (outcome.kind === 'queued' && outcome.runnable) await deps.queue.sendRun(job);
  }

  async function run(job: TaskJob): Promise<void> {
    const startedAtMs = now();
    const claim = await withCompany(deps.database, job.companyId, async (tx) => {
      const queued = await taskById(tx, job.taskId);
      if (!queued?.conversationId) return null;
      await lockConversation(tx, queued.conversationId);
      const task = await claimTask(tx, job.taskId);
      if (!task) return null;
      // The worker or the person may have changed while the Task waited (design D5).
      const intake = task.requestedByMemberId
        ? await readIntake(tx, { workerId: task.workerId, memberId: task.requestedByMemberId })
        : null;
      return { task, intake };
    });
    // 0 rows: another runner took it, or it is not its turn (design D2). Drop the job.
    if (!claim) return;
    const { task, intake } = claim;

    if (intake?.decision.kind !== 'accept') {
      const notice: NoticeKind =
        intake?.decision.kind === 'notice' ? intake.decision.notice : 'no_access';
      await cancel(task, notice, intake?.worker.name ?? '');
      if (notice === 'budget_exhausted' && intake && deps.onBudgetExhausted) {
        await deps
          .onBudgetExhausted(task.companyId, intake.worker)
          .catch((error: unknown) =>
            deps.logger.error({ taskId: task.id, error: describe(error) }, 'budget alert failed'),
          );
      }
      return;
    }

    const beat = setInterval(() => {
      void withCompany(deps.database, task.companyId, (tx) => heartbeat(tx, task.id)).catch(
        (error: unknown) =>
          deps.logger.warn({ taskId: task.id, error: describe(error) }, 'heartbeat failed'),
      );
    }, heartbeatMs);
    try {
      const context = await withCompany(deps.database, task.companyId, (tx) =>
        loadTaskContext(tx, task),
      );
      if (!context) {
        await end(task, 'failed', 'error', noticeText('error', ''));
        return;
      }
      await deps.channel
        .sendTyping(target(task))
        .catch((error: unknown) =>
          deps.logger.warn({ taskId: task.id, error: describe(error) }, 'typing failed'),
        );
      const promptAt = await withCompany(deps.database, task.companyId, (tx) => databaseNow(tx));
      const result = await runLoop(
        {
          database: deps.database,
          gateway: deps.gateway,
          model: deps.model,
          limits: deps.limits,
          logger: deps.logger,
          now,
        },
        {
          companyId: task.companyId,
          workerId: task.workerId,
          taskId: task.id,
          system: buildSystemPrompt(context.profile, context.summaries, promptAt),
          messages: toModelMessages(context.history, context.taskMessages),
          skills: context.skills,
          tools: skillToolSet(),
          startedAtMs,
        },
      );
      const name = context.profile.workerName;
      if (result.kind === 'lost') {
        deps.logger.warn({ companyId: task.companyId, taskId: task.id }, 'task ended elsewhere');
      } else if (result.kind === 'answer') {
        await end(
          task,
          'succeeded',
          null,
          result.text.trim() || noticeText('error', name),
          result.text.trim() ? 'worker' : 'notice',
        );
      } else if (result.kind === 'stopped') {
        const notice: NoticeKind =
          result.reason === 'credit_exhausted' ? 'credit_exhausted_midway' : result.reason;
        await end(
          task,
          'stopped',
          result.reason,
          noticeText(notice, name),
          'notice',
          result.partialText,
        );
      } else {
        await end(task, 'failed', 'error', noticeText('error', name));
      }
    } catch (error) {
      deps.logger.error({ taskId: task.id, error: describe(error) }, 'task failed');
      await end(task, 'failed', 'error', noticeText('error', '')).catch((failure: unknown) =>
        deps.logger.error({ taskId: task.id, error: describe(failure) }, 'task not ended'),
      );
    } finally {
      clearInterval(beat);
    }
  }

  /**
   * Ends the Task under the conversation lock first, and replies only when this runner
   * ended it: a Task the reaper already marked lost gets no second reply (design D9). The
   * next Task is dispatched after the reply, so answers keep the order of the messages.
   */
  async function end(
    task: TaskRow,
    status: 'succeeded' | 'failed' | 'stopped',
    reason: StopReason | null,
    text: string,
    role: 'worker' | 'notice' = 'notice',
    partialText = '',
  ): Promise<void> {
    const ended = await withCompany(deps.database, task.companyId, async (tx) => {
      if (task.conversationId) await lockConversation(tx, task.conversationId);
      return finishTask(tx, task.id, status, reason);
    });
    if (!ended) {
      deps.logger.warn(
        { companyId: task.companyId, taskId: task.id },
        'task already ended: no reply',
      );
      return;
    }
    deps.logger.info(
      { companyId: task.companyId, taskId: task.id, status, stopReason: reason },
      'task finished',
    );
    try {
      if (partialText.trim()) {
        await deps.channel.send(target(task), {
          text: partialText.trim(),
          role: 'worker',
          taskId: task.id,
        });
      }
      await deps.channel.send(target(task), { text, role, taskId: task.id });
    } catch (error) {
      deps.logger.error({ taskId: task.id, error: describe(error) }, 'reply not sent');
    }
    await dispatchNext(task.companyId, task.conversationId);
  }

  async function cancel(task: TaskRow, notice: NoticeKind, workerName: string): Promise<void> {
    const ended = await withCompany(deps.database, task.companyId, async (tx) => {
      if (task.conversationId) await lockConversation(tx, task.conversationId);
      return finishTask(tx, task.id, 'cancelled', CANCEL_REASON[notice]);
    });
    if (ended) {
      await deps.channel.send(target(task), {
        text: noticeText(notice, workerName),
        role: 'notice',
        taskId: task.id,
      });
    }
    await dispatchNext(task.companyId, task.conversationId);
  }

  /** task.reap (design D9): lost runners and orphaned jobs, never running a Task twice. */
  async function reap(): Promise<void> {
    const due = await tasksNeedingAttention(deps.database, {
      lostAfterSeconds: deps.lostAfterSeconds ?? 60,
      orphanAfterSeconds: deps.orphanAfterSeconds ?? 120,
    });
    for (const item of due) {
      try {
        const job = { companyId: item.companyId, taskId: item.taskId };
        if (item.kind === 'collecting') await deps.queue.sendStart(job, 0);
        else if (item.kind === 'queued') await deps.queue.sendRun(job);
        else await markLost(item.companyId, item.taskId);
      } catch (error) {
        deps.logger.error({ taskId: item.taskId, error: describe(error) }, 'reap failed');
      }
    }
  }

  async function markLost(companyId: string, taskId: string): Promise<void> {
    const lostAfter = deps.lostAfterSeconds ?? 60;
    const task = await withCompany(deps.database, companyId, async (tx) => {
      const row = await taskById(tx, taskId);
      if (!row?.conversationId || row.status !== 'running' || !row.heartbeatAt) return null;
      await lockConversation(tx, row.conversationId);
      const at = await databaseNow(tx);
      if (at.getTime() - row.heartbeatAt.getTime() < lostAfter * 1000) return null;
      // Never run again: the model may have been paid already (0.2 #132).
      return (await finishTask(tx, taskId, 'failed', 'runner_lost')) ? row : null;
    });
    if (!task) return;
    deps.logger.warn({ companyId, taskId }, 'task lost: runner stopped reporting');
    await deps.channel.send(target(task), {
      text: noticeText('runner_lost', ''),
      role: 'notice',
      taskId,
    });
    await dispatchNext(companyId, task.conversationId);
  }

  return { start, run, reap };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
