import {
  actorMay,
  avatarColorFor,
  BUDGET_ERRORS,
  budgetError,
  decideTransition,
  findWorkerTemplate,
  PROBATION_BUDGET_VND,
  WORKER_ERRORS,
  type WorkerInput,
  type WorkerPatchInput,
  workerNameKey,
} from '@dw/core';
import {
  type CompanyTx,
  departments,
  isUniqueViolation,
  recordAudit,
  workers,
  workerTesters,
} from '@dw/db';
import { and, eq, inArray, ne, sql } from '@dw/db/drizzle';
import { denied, fieldError, notFound, type Outcome, ok, rejected } from '../org/outcome.ts';
import { departmentHeadId, type FreshActor, memberEligibility, workerActor } from './people.ts';
import { lifecycleState, loadWorker, pendingProposal, recordWorkerEvent } from './store.ts';

const NAME_INDEX = 'workers_company_name_live_uq';
const nameTaken = () =>
  rejected(409, 'WORKER_NAME_TAKEN', [{ path: 'name', message: 'worker_name_taken' }]);
const offboarded = () => rejected(409, WORKER_ERRORS.offboarded);

/** Maps a unique violation from a worker write (two people saving one name) to 409. */
export function workerWriteError(error: unknown): Outcome<never> {
  if (isUniqueViolation(error, NAME_INDEX)) return nameTaken();
  if (isUniqueViolation(error, 'worker_promotion_requests_pending_uq')) {
    return rejected(409, WORKER_ERRORS.proposalPending);
  }
  throw error;
}

async function liveNameTaken(tx: CompanyTx, name: string, exceptId?: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: workers.id })
    .from(workers)
    .where(
      and(
        eq(workers.nameKey, workerNameKey(name)),
        ne(workers.status, 'offboarded'),
        exceptId ? ne(workers.id, exceptId) : undefined,
      ),
    );
  return Boolean(row);
}

/**
 * POST /api/workers — a draft from a template or blank (FR-02-07, design D4). Manager
 * defaults to the department head, else the creator; testers default to the manager.
 */
export async function createWorker(
  tx: CompanyTx,
  member: { readonly memberId: string },
  input: WorkerInput,
): Promise<Outcome<{ id: string }>> {
  const actor = await workerActor(tx, member);
  if (!actor) return denied('FORBIDDEN');
  const [department] = await tx
    .select({ id: departments.id, archivedAt: departments.archivedAt })
    .from(departments)
    .where(eq(departments.id, input.departmentId))
    .for('share');
  if (!department) return notFound;
  if (!actorMay(actor, 'worker.create', department.id)) return denied('FORBIDDEN');
  if (department.archivedAt) return fieldError('departmentId', 'department_archived');
  const template = input.templateId ? findWorkerTemplate(input.templateId) : null;
  if (input.templateId && !template) return fieldError('templateId', 'template_not_found');
  if (await liveNameTaken(tx, input.name)) return nameTaken();

  const managerMemberId = (await departmentHeadId(tx, department.id)) ?? actor.memberId;
  const [created] = await tx
    .insert(workers)
    .values({
      companyId: sql`app.current_company_id()`,
      departmentId: department.id,
      name: input.name,
      nameKey: workerNameKey(input.name),
      avatarColor: avatarColorFor(input.name),
      jobDescription: template?.jobDescription ?? '',
      voicePreset: template?.voicePreset ?? null,
      monthlyBudgetVnd: PROBATION_BUDGET_VND,
      managerMemberId,
      templateId: template?.id ?? null,
      createdByMemberId: actor.memberId,
    })
    .returning({ id: workers.id });
  if (!created) throw new Error('worker insert returned nothing');
  await tx.insert(workerTesters).values({
    companyId: sql`app.current_company_id()`,
    workerId: created.id,
    memberId: managerMemberId,
    addedByMemberId: actor.memberId,
  });
  // The template id is a fixed identifier from code, not user content (spec audit-log).
  await recordWorkerEvent(
    tx,
    created.id,
    {
      kind: 'created',
      toStatus: 'draft',
      actorMemberId: actor.memberId,
      templateId: template?.id ?? null,
    },
    {
      action: 'worker.created',
      fields: template ? [`template:${template.id}`] : ['template:blank'],
    },
  );
  return ok(created);
}

type Editable = { actor: FreshActor; worker: NonNullable<Awaited<ReturnType<typeof loadWorker>>> };

/** Actor + locked worker for an edit: 404 / 403 / 409 offboarded, in that order. */
async function beginEdit(
  tx: CompanyTx,
  member: { readonly memberId: string },
  id: string,
  action: 'worker.edit' | 'org.manage',
): Promise<Outcome<Editable>> {
  const actor = await workerActor(tx, member);
  if (!actor) return denied('FORBIDDEN');
  const worker = await loadWorker(tx, id, 'update');
  if (!worker) return notFound;
  if (!actorMay(actor, action, worker.departmentId)) return denied('FORBIDDEN');
  if (worker.status === 'offboarded') return offboarded();
  return ok({ actor, worker });
}

async function managerChoice(
  tx: CompanyTx,
  memberId: string,
  departmentId: string,
): Promise<Outcome<string>> {
  const eligibility = await memberEligibility(tx, memberId, departmentId);
  if (eligibility === 'missing') return notFound;
  if (eligibility === 'ineligible') return fieldError('managerMemberId', 'manager_not_eligible');
  return ok(memberId);
}

/** PATCH /api/workers/:id (design D4): optimistic `revision`, budget cap, valid manager. */
export async function patchWorker(
  tx: CompanyTx,
  member: { readonly memberId: string },
  id: string,
  patch: WorkerPatchInput,
): Promise<Outcome<{ id: string; revision: number; changed: string[] }>> {
  const begun = await beginEdit(tx, member, id, 'worker.edit');
  if (!begun.ok) return begun;
  const { actor, worker } = begun.value;
  if (patch.revision !== worker.revision) return rejected(409, 'PROFILE_CHANGED');

  const set: Partial<typeof workers.$inferInsert> = {};
  const changed: string[] = [];
  if (patch.name !== undefined && patch.name !== worker.name) {
    if (await liveNameTaken(tx, patch.name, id)) return nameTaken();
    set.name = patch.name;
    set.nameKey = workerNameKey(patch.name);
    changed.push('name');
  }
  if (patch.jobDescription !== undefined && patch.jobDescription !== worker.jobDescription) {
    set.jobDescription = patch.jobDescription;
    changed.push('job_description');
  }
  if (patch.voicePreset !== undefined && patch.voicePreset !== worker.voicePreset) {
    set.voicePreset = patch.voicePreset;
    changed.push('voice_preset');
  }
  if (patch.voiceCustom !== undefined && patch.voiceCustom !== worker.voiceCustom) {
    set.voiceCustom = patch.voiceCustom;
    changed.push('voice_custom');
  }
  if (patch.monthlyBudgetVnd !== undefined) {
    if (budgetError(actor.role, worker.monthlyBudgetVnd, patch.monthlyBudgetVnd)) {
      return denied(BUDGET_ERRORS.aboveManagerCap);
    }
    if (patch.monthlyBudgetVnd !== worker.monthlyBudgetVnd) {
      set.monthlyBudgetVnd = patch.monthlyBudgetVnd;
      changed.push('monthly_budget_vnd');
    }
  }
  if (patch.managerMemberId !== undefined && patch.managerMemberId !== worker.managerMemberId) {
    if (patch.managerMemberId !== null) {
      const choice = await managerChoice(tx, patch.managerMemberId, worker.departmentId);
      if (!choice.ok) return choice;
    }
    set.managerMemberId = patch.managerMemberId;
    changed.push('manager');
  }
  if (changed.length === 0) return ok({ id, revision: worker.revision, changed });

  const revision = worker.revision + 1;
  await tx
    .update(workers)
    .set({ ...set, revision, updatedAt: new Date() })
    .where(eq(workers.id, id));
  await recordAudit(tx, {
    actorMemberId: actor.memberId,
    action: 'worker.updated',
    targetType: 'worker',
    targetId: id,
    fields: changed,
  });
  return ok({ id, revision, changed });
}

/**
 * POST /api/workers/:id/department — Owner / Admin only (0.2 #052). Status stays; the
 * manager becomes the chosen one (default: the new head); testers outside it are dropped.
 */
export async function moveWorker(
  tx: CompanyTx,
  member: { readonly memberId: string },
  id: string,
  input: { departmentId: string; managerMemberId?: string | null },
): Promise<Outcome<{ id: string; changed: boolean }>> {
  const begun = await beginEdit(tx, member, id, 'org.manage');
  if (!begun.ok) return begun;
  const { actor, worker } = begun.value;
  const [department] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, input.departmentId), sql`${departments.archivedAt} IS NULL`))
    .for('share');
  if (!department) return fieldError('departmentId', 'department_not_found');
  if (department.id === worker.departmentId) return ok({ id, changed: false });

  let managerMemberId: string | null;
  if (input.managerMemberId) {
    const choice = await managerChoice(tx, input.managerMemberId, department.id);
    if (!choice.ok) return choice;
    managerMemberId = choice.value;
  } else {
    const keepsCurrent =
      worker.managerMemberId !== null &&
      (await memberEligibility(tx, worker.managerMemberId, department.id)) === 'ok';
    managerMemberId =
      (await departmentHeadId(tx, department.id)) ?? (keepsCurrent ? worker.managerMemberId : null);
  }

  await tx
    .update(workers)
    .set({
      departmentId: department.id,
      managerMemberId,
      revision: worker.revision + 1,
      updatedAt: new Date(),
    })
    .where(eq(workers.id, id));
  const testers = await tx
    .select({ memberId: workerTesters.memberId })
    .from(workerTesters)
    .where(eq(workerTesters.workerId, id));
  const dropped: string[] = [];
  for (const { memberId } of testers) {
    if ((await memberEligibility(tx, memberId, department.id)) !== 'ok') dropped.push(memberId);
  }
  if (dropped.length > 0) {
    await tx
      .delete(workerTesters)
      .where(and(eq(workerTesters.workerId, id), inArray(workerTesters.memberId, dropped)));
  }
  await recordAudit(tx, {
    actorMemberId: actor.memberId,
    action: 'worker.department_changed',
    targetType: 'worker',
    targetId: id,
    fields: ['department', 'manager', ...(dropped.length > 0 ? ['testers'] : [])],
  });
  return ok({ id, changed: true });
}

/** PUT /api/workers/:id/testers — same people who may change the status (0.2 #110). */
export async function setTesters(
  tx: CompanyTx,
  member: { readonly memberId: string },
  id: string,
  memberIds: readonly string[],
): Promise<Outcome<{ id: string; memberIds: string[] }>> {
  const actor = await workerActor(tx, member);
  if (!actor) return denied('FORBIDDEN');
  const worker = await loadWorker(tx, id, 'update');
  if (!worker) return notFound;
  const decision = decideTransition(
    actor,
    lifecycleState(worker, await pendingProposal(tx, id)),
    'editTesters',
    {},
  );
  if (!decision.ok) {
    return decision.error === WORKER_ERRORS.forbidden ? denied('FORBIDDEN') : offboarded();
  }
  for (const memberId of memberIds) {
    const eligibility = await memberEligibility(tx, memberId, worker.departmentId);
    if (eligibility === 'missing') return notFound;
    if (eligibility === 'ineligible') return fieldError('memberIds', 'tester_not_eligible');
  }
  const current = await tx
    .select({ memberId: workerTesters.memberId })
    .from(workerTesters)
    .where(eq(workerTesters.workerId, id));
  const before = new Set(current.map((row) => row.memberId));
  const after = new Set(memberIds);
  const removed = [...before].filter((memberId) => !after.has(memberId));
  const added = [...after].filter((memberId) => !before.has(memberId));
  if (removed.length > 0) {
    await tx
      .delete(workerTesters)
      .where(and(eq(workerTesters.workerId, id), inArray(workerTesters.memberId, removed)));
  }
  if (added.length > 0) {
    await tx.insert(workerTesters).values(
      added.map((memberId) => ({
        companyId: sql`app.current_company_id()`,
        workerId: id,
        memberId,
        addedByMemberId: actor.memberId,
      })),
    );
  }
  if (removed.length + added.length > 0) {
    await recordAudit(tx, {
      actorMemberId: actor.memberId,
      action: 'worker.testers_changed',
      targetType: 'worker',
      targetId: id,
      fields: ['testers'],
    });
  }
  return ok({ id, memberIds: [...after] });
}
