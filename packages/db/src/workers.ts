import { eq } from 'drizzle-orm';
import { workers, workerTesters } from './schema/workers.ts';
import { suspendScriptSkillsOnActivation } from './skills.ts';
import type { CompanyTx } from './tenancy.ts';

export type WorkerStatusValue = (typeof workers.$inferSelect)['status'];

/**
 * What the worker runtime may do with a worker right now (design D8). Changes 5, 6 and 8
 * call this instead of reading columns, so the "only `active` takes real work" rule lives
 * in one place (CLAUDE.md).
 */
export type WorkerRuntimeState = {
  readonly status: WorkerStatusValue;
  /** Telegram / Zalo / schedules: only an active worker takes work from real channels. */
  readonly acceptsRealChannels: boolean;
  /**
   * Who may give it work in web chat: the testers on probation, whoever is assigned
   * (decided by later changes) when active, nobody otherwise.
   */
  readonly acceptsWebChatFrom: readonly string[] | 'assigned';
  /** Fixed reply instead of work, for suspended and offboarded workers. */
  readonly autoReply: 'suspended' | 'offboarded' | null;
  readonly monthlyBudgetVnd: number;
};

/** Runtime state of `workerId` in the transaction's company, or null when not found. */
export async function workerRuntimeState(
  tx: CompanyTx,
  workerId: string,
): Promise<WorkerRuntimeState | null> {
  const [row] = await tx
    .select({ status: workers.status, monthlyBudgetVnd: workers.monthlyBudgetVnd })
    .from(workers)
    .where(eq(workers.id, workerId));
  if (!row) return null;
  const testers =
    row.status === 'probation'
      ? await tx
          .select({ memberId: workerTesters.memberId })
          .from(workerTesters)
          .where(eq(workerTesters.workerId, workerId))
      : [];
  return {
    status: row.status,
    acceptsRealChannels: row.status === 'active',
    acceptsWebChatFrom:
      row.status === 'active' ? 'assigned' : testers.map((tester) => tester.memberId).sort(),
    autoReply: row.status === 'suspended' || row.status === 'offboarded' ? row.status : null,
    monthlyBudgetVnd: row.monthlyBudgetVnd,
  };
}

/**
 * Runs inside the transaction that makes a worker active (design D3): script skills
 * are suspended until review exists (change add-skill-library, D8).
 */
export async function onWorkerActivated(
  tx: CompanyTx,
  workerId: string,
  actorMemberId: string | null,
): Promise<void> {
  await suspendScriptSkillsOnActivation(tx, workerId, actorMemberId);
}

/**
 * Runs inside the transaction that offboards a worker. Empty in change 2; changes 6, 8
 * and 9 add revoking connector grants, removing bots and stopping schedules.
 */
export async function onWorkerOffboarded(_tx: CompanyTx, _workerId: string): Promise<void> {}
