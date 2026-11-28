import type { WorkerLifecycleState } from '@dw/core';
import {
  type CompanyTx,
  recordAudit,
  workerPromotionRequests,
  workerStatusEvents,
  workers,
} from '@dw/db';
import { and, eq, sql } from '@dw/db/drizzle';

export type WorkerRow = typeof workers.$inferSelect;

/** The worker row (this company only, through RLS), optionally locked FOR UPDATE. */
export async function loadWorker(
  tx: CompanyTx,
  id: string,
  lock: 'update' | 'none' = 'none',
): Promise<WorkerRow | null> {
  const query = tx.select().from(workers).where(eq(workers.id, id));
  const [row] = lock === 'update' ? await query.for('update') : await query;
  return row ?? null;
}

export type PendingProposal = typeof workerPromotionRequests.$inferSelect;

/** The worker's pending promotion request, if any (at most one, by a partial unique index). */
export async function pendingProposal(
  tx: CompanyTx,
  workerId: string,
  lock: 'update' | 'none' = 'none',
): Promise<PendingProposal | null> {
  const query = tx
    .select()
    .from(workerPromotionRequests)
    .where(
      and(
        eq(workerPromotionRequests.workerId, workerId),
        eq(workerPromotionRequests.status, 'pending'),
      ),
    );
  const [row] = lock === 'update' ? await query.for('update') : await query;
  return row ?? null;
}

/** What the pure state machine needs from a worker row. */
export function lifecycleState(
  worker: WorkerRow,
  pending: PendingProposal | null,
): WorkerLifecycleState {
  return {
    status: worker.status,
    departmentId: worker.departmentId,
    name: worker.name,
    jobDescription: worker.jobDescription,
    hasPendingProposal: pending !== null,
  };
}

export type HistoryEntry = Omit<
  typeof workerStatusEvents.$inferInsert,
  'id' | 'companyId' | 'createdAt' | 'workerId'
>;

/** Appends a status-history row and the matching AuditEvent (field names only). */
export async function recordWorkerEvent(
  tx: CompanyTx,
  workerId: string,
  entry: HistoryEntry,
  audit: { readonly action: string; readonly fields?: readonly string[] },
): Promise<void> {
  await tx
    .insert(workerStatusEvents)
    .values({ companyId: sql`app.current_company_id()`, workerId, ...entry });
  await recordAudit(tx, {
    actorMemberId: entry.actorMemberId,
    action: audit.action,
    targetType: 'worker',
    targetId: workerId,
    fields: audit.fields ?? null,
  });
}
