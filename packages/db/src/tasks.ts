import { type CoalesceWindow, canJoinWindow, windowClosesIn } from '@dw/core';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from './client.ts';
import { type StopReason, tasks } from './schema/tasks.ts';
import type { CompanyTx } from './tenancy.ts';

/**
 * Task lifecycle in the database (design D2, D4, D9). Callers hold the conversation lock
 * (`lockConversation`) for every function that changes which Task of a conversation runs.
 * Times come from PostgreSQL (`now()`), never from the process clock.
 */

export type TaskRow = typeof tasks.$inferSelect;
export type TaskSource = TaskRow['source'];
export type FinalStatus = 'succeeded' | 'failed' | 'stopped' | 'cancelled';

/**
 * PostgreSQL's clock at this moment (`clock_timestamp()`, not the transaction's start):
 * read after the conversation lock, it orders events the way they were serialised.
 */
export async function databaseNow(tx: CompanyTx): Promise<Date> {
  const result = await tx.execute<{ now: Date | string }>(sql`select clock_timestamp() as now`);
  const value = result.rows[0]?.now;
  return value instanceof Date ? value : new Date(String(value));
}

export async function taskById(tx: CompanyTx, taskId: string): Promise<TaskRow | null> {
  const [row] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
  return row ?? null;
}

export interface TaskIntake {
  readonly companyId: string;
  readonly workerId: string;
  readonly conversationId: string;
  readonly memberId: string;
  readonly source: TaskSource;
  readonly window: CoalesceWindow;
}

/**
 * Puts an accepted message into the member's collecting Task of the conversation when the
 * window allows (FR-04-07), otherwise into a new Task (0.2 #124, #125). `closeNow` means
 * the window just filled up (20 messages) and should close without waiting.
 */
export async function joinOrCreateTask(
  tx: CompanyTx,
  intake: TaskIntake,
): Promise<{ readonly task: TaskRow; readonly created: boolean; readonly closeNow: boolean }> {
  const now = await databaseNow(tx);
  const [collecting] = await tx
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.conversationId, intake.conversationId),
        eq(tasks.requestedByMemberId, intake.memberId),
        eq(tasks.status, 'collecting'),
      ),
    )
    .orderBy(desc(tasks.createdAt))
    .limit(1);
  if (
    collecting?.firstMessageAt &&
    collecting.lastMessageAt &&
    canJoinWindow(
      {
        firstMessageAt: collecting.firstMessageAt,
        lastMessageAt: collecting.lastMessageAt,
        messageCount: collecting.messageCount,
      },
      now,
      intake.window,
    )
  ) {
    const [joined] = await tx
      .update(tasks)
      .set({ messageCount: sql`${tasks.messageCount} + 1`, lastMessageAt: now })
      .where(eq(tasks.id, collecting.id))
      .returning();
    if (!joined) throw new Error('collecting task vanished');
    return {
      task: joined,
      created: false,
      closeNow: joined.messageCount >= intake.window.maxMessages,
    };
  }
  const [created] = await tx
    .insert(tasks)
    .values({
      companyId: intake.companyId,
      workerId: intake.workerId,
      conversationId: intake.conversationId,
      requestedByMemberId: intake.memberId,
      source: intake.source,
      status: 'collecting',
      messageCount: 1,
      firstMessageAt: now,
      lastMessageAt: now,
    })
    .returning();
  if (!created) throw new Error('task not created');
  return { task: created, created: true, closeNow: intake.window.maxMessages <= 1 };
}

export type WindowOutcome =
  | { readonly kind: 'not_collecting' }
  | { readonly kind: 'wait'; readonly ms: number }
  | { readonly kind: 'queued'; readonly runnable: boolean };

/** task.start (design D4): closes the window when due, else says how long to wait. */
export async function closeWindowIfDue(
  tx: CompanyTx,
  taskId: string,
  window: CoalesceWindow,
): Promise<WindowOutcome> {
  const task = await taskById(tx, taskId);
  if (task?.status !== 'collecting' || !task.firstMessageAt || !task.lastMessageAt) {
    return { kind: 'not_collecting' };
  }
  const now = await databaseNow(tx);
  const ms = windowClosesIn(
    {
      firstMessageAt: task.firstMessageAt,
      lastMessageAt: task.lastMessageAt,
      messageCount: task.messageCount,
    },
    now,
    window,
  );
  if (ms > 0) return { kind: 'wait', ms };
  await tx
    .update(tasks)
    .set({ status: 'queued', queuedAt: sql`clock_timestamp()` })
    .where(and(eq(tasks.id, taskId), eq(tasks.status, 'collecting')));
  return { kind: 'queued', runnable: (await nextRunnable(tx, task.conversationId)) === taskId };
}

/**
 * The only way a Task starts (design D2): `queued → running` when nothing else of the
 * conversation runs and no older Task waits. 0 rows = someone else took it, or not its
 * turn yet: the job is dropped. A job delivered twice therefore runs once.
 */
export async function claimTask(tx: CompanyTx, taskId: string): Promise<TaskRow | null> {
  const [row] = await tx
    .update(tasks)
    .set({ status: 'running', startedAt: sql`now()`, heartbeatAt: sql`now()` })
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.status, 'queued'),
        sql`NOT EXISTS (SELECT 1 FROM tasks r WHERE r.company_id = ${tasks.companyId}
              AND r.conversation_id = ${tasks.conversationId} AND r.status = 'running')`,
        sql`NOT EXISTS (SELECT 1 FROM tasks q WHERE q.company_id = ${tasks.companyId}
              AND q.conversation_id = ${tasks.conversationId} AND q.status = 'queued'
              AND (q.queued_at, q.id) < (${tasks.queuedAt}, ${tasks.id}))`,
      ),
    )
    .returning();
  return row ?? null;
}

/** The queued Task that should run next in the conversation, if it may start now. */
export async function nextRunnable(
  tx: CompanyTx,
  conversationId: string | null,
): Promise<string | null> {
  if (!conversationId) return null;
  const running = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.conversationId, conversationId), eq(tasks.status, 'running')))
    .limit(1);
  if (running.length > 0) return null;
  const [next] = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.conversationId, conversationId), eq(tasks.status, 'queued')))
    .orderBy(tasks.queuedAt, tasks.id)
    .limit(1);
  return next?.id ?? null;
}

/** After each model call (design D6): one more step, its charge, and a heartbeat. */
export async function recordStep(
  tx: CompanyTx,
  taskId: string,
  chargeVnd: number,
): Promise<boolean> {
  const rows = await tx
    .update(tasks)
    .set({
      steps: sql`${tasks.steps} + 1`,
      chargeVnd: sql`${tasks.chargeVnd} + ${chargeVnd}`,
      heartbeatAt: sql`now()`,
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.status, 'running')))
    .returning({ id: tasks.id });
  return rows.length > 0;
}

export async function heartbeat(tx: CompanyTx, taskId: string): Promise<void> {
  await tx
    .update(tasks)
    .set({ heartbeatAt: sql`now()` })
    .where(and(eq(tasks.id, taskId), eq(tasks.status, 'running')));
}

/**
 * Ends a Task that has not ended yet. Returns false when it already had (e.g. the
 * reaper marked it lost), so the caller does not send a second answer.
 */
export async function finishTask(
  tx: CompanyTx,
  taskId: string,
  status: FinalStatus,
  stopReason: StopReason | null,
): Promise<boolean> {
  const rows = await tx
    .update(tasks)
    .set({ status, stopReason, finishedAt: sql`now()` })
    .where(and(eq(tasks.id, taskId), inArray(tasks.status, ['collecting', 'queued', 'running'])))
    .returning({ id: tasks.id });
  return rows.length > 0;
}

export type AttentionKind = 'lost' | 'collecting' | 'queued';

export interface TaskNeedingAttention {
  readonly companyId: string;
  readonly taskId: string;
  readonly conversationId: string | null;
  readonly kind: AttentionKind;
}

/**
 * Unfinished Tasks across companies that the reaper must handle (design D9), through
 * `app.tasks_needing_attention` (SECURITY DEFINER): ids only. apps/runner only.
 */
export async function tasksNeedingAttention(
  database: Pick<Database, 'pool'>,
  thresholds: { readonly lostAfterSeconds: number; readonly orphanAfterSeconds: number },
): Promise<TaskNeedingAttention[]> {
  const { rows } = await database.pool.query<{
    company_id: string;
    task_id: string;
    conversation_id: string | null;
    kind: AttentionKind;
  }>('select * from app.tasks_needing_attention($1, $2)', [
    thresholds.lostAfterSeconds,
    thresholds.orphanAfterSeconds,
  ]);
  return rows.map((row) => ({
    companyId: row.company_id,
    taskId: row.task_id,
    conversationId: row.conversation_id,
    kind: row.kind,
  }));
}
