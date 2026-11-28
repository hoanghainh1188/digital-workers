import { vnMonthRange, workerMonthSpend } from '@dw/billing';
import {
  type ChatAccess,
  type CoalesceWindow,
  canChatWith,
  evaluateIntake,
  type IntakeDecision,
  noticeText,
  type WorkerStatus,
} from '@dw/core';
import {
  type ChatMessage,
  type CompanyTx,
  conversationById,
  creditAccounts,
  type Database,
  databaseNow,
  insertMessage,
  joinOrCreateTask,
  lockConversation,
  members,
  messageByClientId,
  notifyChat,
  type TaskSource,
  withCompany,
  workers,
  workerTesters,
} from '@dw/db';
import { eq } from '@dw/db/drizzle';
import type { TaskQueue } from '@dw/db/queue';

/**
 * Receiving a message from a channel (design D3, D5). Shared by web chat (apps/api), the
 * runner's re-check when a Task starts, and Telegram / Zalo later. Permission is checked
 * here, in code — never left to the prompt (CLAUDE.md).
 */

export interface IntakeWorker {
  readonly id: string;
  readonly name: string;
  readonly status: WorkerStatus;
  readonly departmentId: string;
  readonly monthlyBudgetVnd: number;
  readonly managerMemberId: string | null;
}

export interface IntakeState {
  readonly worker: IntakeWorker;
  readonly access: ChatAccess;
  readonly decision: IntakeDecision;
}

/**
 * Reads worker, member (role and department as they are now), testers, balance and the
 * worker's spend this month, then decides (`evaluateIntake`). Null when the worker is not
 * in the transaction's company; a locked or missing member gets `forbidden`.
 */
export async function readIntake(
  tx: CompanyTx,
  input: { readonly workerId: string; readonly memberId: string },
): Promise<IntakeState | null> {
  const [worker] = await tx
    .select({
      id: workers.id,
      name: workers.name,
      status: workers.status,
      departmentId: workers.departmentId,
      monthlyBudgetVnd: workers.monthlyBudgetVnd,
      managerMemberId: workers.managerMemberId,
      companyId: workers.companyId,
    })
    .from(workers)
    .where(eq(workers.id, input.workerId));
  if (!worker) return null;
  const [member] = await tx
    .select({ role: members.role, status: members.status, departmentId: members.departmentId })
    .from(members)
    .where(eq(members.id, input.memberId));
  const testers = await tx
    .select({ memberId: workerTesters.memberId })
    .from(workerTesters)
    .where(eq(workerTesters.workerId, input.workerId));
  const access: ChatAccess =
    member?.status === 'active'
      ? canChatWith(
          { memberId: input.memberId, role: member.role, departmentId: member.departmentId },
          { status: worker.status, departmentId: worker.departmentId },
          testers.map((row) => row.memberId),
        )
      : 'forbidden';
  const [account] = await tx
    .select({ balance: creditAccounts.balanceVnd })
    .from(creditAccounts)
    .where(eq(creditAccounts.companyId, worker.companyId));
  const now = await databaseNow(tx);
  const decision = evaluateIntake({
    workerStatus: worker.status,
    access,
    balanceVnd: account?.balance ?? 0,
    monthSpendVnd: await workerMonthSpend(tx, worker.id, now),
    monthlyBudgetVnd: worker.monthlyBudgetVnd,
  });
  return {
    worker: {
      id: worker.id,
      name: worker.name,
      status: worker.status,
      departmentId: worker.departmentId,
      monthlyBudgetVnd: worker.monthlyBudgetVnd,
      managerMemberId: worker.managerMemberId,
    },
    access,
    decision,
  };
}

export interface ReceiveInput {
  readonly companyId: string;
  readonly workerId: string;
  readonly memberId: string;
  readonly conversationId: string;
  readonly text: string;
  readonly clientMessageId: string;
  readonly source: TaskSource;
}

export type ReceiveResult =
  | { readonly kind: 'refused'; readonly access: Exclude<ChatAccess, 'ok'> }
  /** The conversation was closed ("Cuộc trò chuyện mới") before this message got in. */
  | { readonly kind: 'closed' }
  | {
      readonly kind: 'stored';
      /** False when the same clientMessageId was already stored (0.2 #135). */
      readonly created: boolean;
      readonly message: ChatMessage;
      readonly notice: ChatMessage | null;
      readonly taskId: string | null;
    };

export interface ReceiveDeps {
  readonly database: Pick<Database, 'db'>;
  readonly queue: TaskQueue;
  readonly window: CoalesceWindow;
  /** Called after commit when the worker answered "hết ngân sách" (0.2 #129). */
  readonly onBudgetExhausted?: (companyId: string, worker: IntakeWorker) => Promise<void>;
  readonly onQueueError?: (error: unknown) => void;
}

/**
 * Stores a message and either joins / creates a Task or answers with a fixed notice, in
 * one transaction under the conversation lock. Jobs are sent after commit; if sending
 * fails, the reaper re-sends after 2 minutes (0.2 #137).
 */
export async function receiveMessage(
  deps: ReceiveDeps,
  input: ReceiveInput,
): Promise<ReceiveResult> {
  const outcome = await withCompany(deps.database, input.companyId, async (tx) => {
    await lockConversation(tx, input.conversationId);
    const existing = await messageByClientId(tx, input.conversationId, input.clientMessageId);
    const conversation = existing ? null : await conversationById(tx, input.conversationId);
    if (!existing && conversation?.status !== 'open') {
      return { result: { kind: 'closed' }, start: null, budget: null } as const;
    }
    if (existing) {
      return {
        result: {
          kind: 'stored',
          created: false,
          message: existing,
          notice: null,
          taskId: existing.taskId,
        },
        start: null,
        budget: null,
      } as const;
    }
    const state = await readIntake(tx, { workerId: input.workerId, memberId: input.memberId });
    if (!state)
      return {
        result: { kind: 'refused', access: 'forbidden' },
        start: null,
        budget: null,
      } as const;
    if (state.decision.kind === 'refuse') {
      return {
        result: { kind: 'refused', access: state.decision.access },
        start: null,
        budget: null,
      } as const;
    }
    if (state.decision.kind === 'notice') {
      const { message } = await insertMessage(tx, {
        companyId: input.companyId,
        conversationId: input.conversationId,
        taskId: null,
        role: 'user',
        content: input.text,
        clientMessageId: input.clientMessageId,
      });
      const { message: notice } = await insertMessage(tx, {
        companyId: input.companyId,
        conversationId: input.conversationId,
        taskId: null,
        role: 'notice',
        content: noticeText(state.decision.notice, state.worker.name),
      });
      for (const stored of [message, notice]) {
        await notifyChat(tx, {
          companyId: input.companyId,
          conversationId: input.conversationId,
          event: 'message',
          messageId: stored.id,
        });
      }
      return {
        result: { kind: 'stored', created: true, message, notice, taskId: null },
        start: null,
        budget: state.decision.notice === 'budget_exhausted' ? state.worker : null,
      } as const;
    }
    const { task, created, closeNow } = await joinOrCreateTask(tx, {
      companyId: input.companyId,
      workerId: input.workerId,
      conversationId: input.conversationId,
      memberId: input.memberId,
      source: input.source,
      window: deps.window,
    });
    const { message } = await insertMessage(tx, {
      companyId: input.companyId,
      conversationId: input.conversationId,
      taskId: task.id,
      role: 'user',
      content: input.text,
      clientMessageId: input.clientMessageId,
    });
    await notifyChat(tx, {
      companyId: input.companyId,
      conversationId: input.conversationId,
      event: 'message',
      messageId: message.id,
    });
    const start = closeNow ? 0 : created ? deps.window.gapMs : null;
    return {
      result: { kind: 'stored', created: true, message, notice: null, taskId: task.id },
      start: start === null ? null : { taskId: task.id, afterMs: start },
      budget: null,
    } as const;
  });

  if (outcome.start) {
    await deps.queue
      .sendStart(
        { companyId: input.companyId, taskId: outcome.start.taskId },
        outcome.start.afterMs,
      )
      .catch((error: unknown) => deps.onQueueError?.(error));
  }
  if (outcome.budget && deps.onBudgetExhausted) {
    await deps
      .onBudgetExhausted(input.companyId, outcome.budget)
      .catch((error: unknown) => deps.onQueueError?.(error));
  }
  return outcome.result;
}

/** `YYYY-MM` of the Vietnam calendar month containing `at`. */
export function vnMonthKey(at: Date): string {
  const { start } = vnMonthRange(at);
  return new Date(start.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 7);
}
