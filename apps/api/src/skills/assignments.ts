import {
  ASSIGNMENT_ERROR_HTTP,
  ASSIGNMENT_ERRORS,
  actorMay,
  canAssignSkills,
  decideAssignment,
  type RiskLevel,
  type WorkerSkillStatus,
} from '@dw/core';
import {
  type CompanyTx,
  recordAudit,
  skills,
  skillVersions,
  workerSkills,
  workerSkillTarget,
} from '@dw/db';
import { and, asc, eq, sql } from '@dw/db/drizzle';
import { denied, notFound, type Outcome, ok, rejected } from '../org/outcome.ts';
import { type FreshActor, peopleById } from '../workers/people.ts';
import { loadWorker, type WorkerRow } from '../workers/store.ts';
import { loadSkill, versionById } from './store.ts';

/** Giving skills to workers (spec worker-skills, design D8). Rules: `decideAssignment`. */

const assignmentError = (code: keyof typeof ASSIGNMENT_ERROR_HTTP): Outcome<never> => {
  const status = ASSIGNMENT_ERROR_HTTP[code];
  return status === 403 ? denied(code) : rejected(status, code);
};

async function assignmentRow(tx: CompanyTx, workerId: string, skillId: string, lock = false) {
  const query = tx
    .select()
    .from(workerSkills)
    .where(and(eq(workerSkills.workerId, workerId), eq(workerSkills.skillId, skillId)));
  const [row] = lock ? await query.for('update') : await query;
  return row ?? null;
}

async function audit(
  tx: CompanyTx,
  actor: FreshActor,
  action: string,
  workerId: string,
  skillId: string,
) {
  await recordAudit(tx, {
    actorMemberId: actor.memberId,
    action,
    ...workerSkillTarget(workerId, skillId),
    fields: action === 'worker_skill.removed' ? null : ['status'],
  });
}

/** The worker (locked) when it exists in this company. */
async function workerFor(tx: CompanyTx, workerId: string): Promise<WorkerRow | null> {
  return loadWorker(tx, workerId, 'update');
}

export type AssignmentView = {
  readonly skillId: string;
  readonly name: string;
  readonly title: string;
  readonly status: WorkerSkillStatus;
  readonly currentNumber: number | null;
  readonly pendingNumber: number | null;
  readonly risk: RiskLevel | null;
  readonly hasScripts: boolean;
  readonly assignedBy: { id: string; name: string } | null;
  readonly decidedBy: { id: string; name: string } | null;
  readonly requestedAt: string;
};

/** GET /api/workers/:id/skills — who may view the worker sees its skills (#047). */
export async function workerSkillList(
  tx: CompanyTx,
  actor: FreshActor,
  workerId: string,
): Promise<Outcome<{ skills: AssignmentView[]; canAssign: boolean; canApprove: boolean }>> {
  const worker = await loadWorker(tx, workerId);
  if (!worker) return notFound;
  if (!actorMay(actor, 'worker.view', worker.departmentId)) return denied('FORBIDDEN');
  const rows = await tx
    .select({
      skillId: skills.id,
      name: skills.name,
      title: skills.title,
      status: workerSkills.status,
      currentVersionId: skills.currentVersionId,
      assignedByMemberId: workerSkills.assignedByMemberId,
      decidedByMemberId: workerSkills.decidedByMemberId,
      requestedAt: workerSkills.requestedAt,
    })
    .from(workerSkills)
    .innerJoin(skills, eq(skills.id, workerSkills.skillId))
    .where(eq(workerSkills.workerId, workerId))
    .orderBy(asc(skills.title));
  const pending = await tx
    .select({ skillId: skillVersions.skillId, number: skillVersions.number })
    .from(skillVersions)
    .where(eq(skillVersions.status, 'pending'));
  const pendingBySkill = new Map(pending.map((row) => [row.skillId, row.number]));
  const people = await peopleById(
    tx,
    rows.flatMap((row) => [row.assignedByMemberId, row.decidedByMemberId]),
  );
  const views: AssignmentView[] = [];
  for (const row of rows) {
    const current = row.currentVersionId ? await versionById(tx, row.currentVersionId) : null;
    views.push({
      skillId: row.skillId,
      name: row.name,
      title: row.title,
      status: row.status,
      currentNumber: current?.number ?? null,
      pendingNumber: pendingBySkill.get(row.skillId) ?? null,
      risk: current?.risk ?? null,
      hasScripts: current?.hasScripts ?? false,
      assignedBy: people.get(row.assignedByMemberId) ?? null,
      decidedBy: row.decidedByMemberId ? (people.get(row.decidedByMemberId) ?? null) : null,
      requestedAt: row.requestedAt.toISOString(),
    });
  }
  return ok({
    skills: views,
    canAssign: canAssignSkills(actor, worker) && worker.status !== 'offboarded',
    canApprove: actor.role === 'owner' || actor.role === 'admin',
  });
}

/** POST /api/workers/:id/skills — the one route both screens use (design D8). */
export async function assignSkill(
  tx: CompanyTx,
  actor: FreshActor,
  workerId: string,
  skillId: string,
): Promise<Outcome<{ status: WorkerSkillStatus }>> {
  const worker = await workerFor(tx, workerId);
  if (!worker) return notFound;
  const skill = await loadSkill(tx, skillId, 'update');
  if (!skill) return notFound;
  const current = skill.currentVersionId ? await versionById(tx, skill.currentVersionId) : null;
  const decision = decideAssignment(actor, worker, {
    archived: skill.archivedAt !== null,
    approved: current !== null,
    hasScripts: current?.hasScripts ?? false,
    alreadyAssigned: (await assignmentRow(tx, workerId, skillId)) !== null,
  });
  if (typeof decision === 'object') return assignmentError(decision.error);
  const status = decision === 'grant' ? 'active' : 'pending';
  await tx.insert(workerSkills).values({
    companyId: sql`app.current_company_id()`,
    workerId,
    skillId,
    status,
    assignedByMemberId: actor.memberId,
    ...(status === 'active' ? { decidedByMemberId: actor.memberId, decidedAt: sql`now()` } : {}),
  });
  await audit(
    tx,
    actor,
    status === 'active' ? 'worker_skill.assigned' : 'worker_skill.requested',
    workerId,
    skillId,
  );
  return ok({ status });
}

/** DELETE /api/workers/:id/skills/:skillId — also cancels a pending request. */
export async function removeSkill(
  tx: CompanyTx,
  actor: FreshActor,
  workerId: string,
  skillId: string,
): Promise<Outcome<{ removed: true }>> {
  const worker = await workerFor(tx, workerId);
  if (!worker) return notFound;
  if (!canAssignSkills(actor, worker)) return denied(ASSIGNMENT_ERRORS.forbidden);
  const row = await assignmentRow(tx, workerId, skillId, true);
  if (!row) return notFound;
  await tx.delete(workerSkills).where(eq(workerSkills.id, row.id));
  await audit(tx, actor, 'worker_skill.removed', workerId, skillId);
  return ok({ removed: true });
}

/** POST /api/workers/:id/skills/:skillId/approve|reject — Owner / Admin only. */
export async function decideRequest(
  tx: CompanyTx,
  actor: FreshActor,
  workerId: string,
  skillId: string,
  decision: 'approve' | 'reject',
): Promise<Outcome<{ status: WorkerSkillStatus | 'rejected' }>> {
  const worker = await workerFor(tx, workerId);
  if (!worker) return notFound;
  const row = await assignmentRow(tx, workerId, skillId, true);
  if (!row) return notFound;
  if (actor.role !== 'owner' && actor.role !== 'admin') return denied(ASSIGNMENT_ERRORS.forbidden);
  if (row.status !== 'pending') return rejected(409, 'NOT_PENDING');
  if (decision === 'reject') {
    await tx.delete(workerSkills).where(eq(workerSkills.id, row.id));
    await audit(tx, actor, 'worker_skill.rejected', workerId, skillId);
    return ok({ status: 'rejected' });
  }
  const skill = await loadSkill(tx, skillId, 'update');
  if (!skill) return notFound;
  const current = skill.currentVersionId ? await versionById(tx, skill.currentVersionId) : null;
  // The rules may have changed since the request (worker activated, skill archived …).
  const recheck = decideAssignment(actor, worker, {
    archived: skill.archivedAt !== null,
    approved: current !== null,
    hasScripts: current?.hasScripts ?? false,
    alreadyAssigned: false,
  });
  if (typeof recheck === 'object') return assignmentError(recheck.error);
  await tx
    .update(workerSkills)
    .set({ status: 'active', decidedByMemberId: actor.memberId, decidedAt: sql`now()` })
    .where(eq(workerSkills.id, row.id));
  await audit(tx, actor, 'worker_skill.approved', workerId, skillId);
  return ok({ status: 'active' });
}
