import { type CompanyTx, recordAudit, workers, workerTesters } from '@dw/db';
import { and, eq, inArray, ne } from '@dw/db/drizzle';
import { departmentHeadId, memberEligibility } from './people.ts';

/**
 * After a member was locked, moved, or changed role (design D5): every live worker they
 * manage but may no longer manage gets the current head of its department (or nobody),
 * and they leave the testers of workers whose department they are no longer in.
 * Runs inside the member write's transaction, after its update.
 */
export async function reassignWorkersOf(
  tx: CompanyTx,
  actorMemberId: string,
  memberId: string,
): Promise<void> {
  const managed = await tx
    .select({ id: workers.id, departmentId: workers.departmentId })
    .from(workers)
    .where(and(eq(workers.managerMemberId, memberId), ne(workers.status, 'offboarded')))
    .for('update');
  for (const worker of managed) {
    if ((await memberEligibility(tx, memberId, worker.departmentId)) === 'ok') continue;
    const head = await departmentHeadId(tx, worker.departmentId);
    const next = head === memberId ? null : head;
    await tx
      .update(workers)
      .set({ managerMemberId: next, updatedAt: new Date() })
      .where(eq(workers.id, worker.id));
    await recordAudit(tx, {
      actorMemberId,
      action: 'worker.manager_reassigned',
      targetType: 'worker',
      targetId: worker.id,
      fields: ['manager'],
    });
  }

  const testing = await tx
    .select({ workerId: workerTesters.workerId, departmentId: workers.departmentId })
    .from(workerTesters)
    .innerJoin(workers, eq(workers.id, workerTesters.workerId))
    .where(eq(workerTesters.memberId, memberId));
  const leave: string[] = [];
  for (const row of testing) {
    if ((await memberEligibility(tx, memberId, row.departmentId)) !== 'ok')
      leave.push(row.workerId);
  }
  if (leave.length > 0) {
    await tx
      .delete(workerTesters)
      .where(and(eq(workerTesters.memberId, memberId), inArray(workerTesters.workerId, leave)));
  }
}
