import {
  activationBudget,
  addDays,
  decideTransition,
  newProbation,
  type ProbationExtension,
  type TransitionRequest,
  WORKER_ERROR_HTTP,
  WORKER_ERRORS,
  type WorkerEvent,
  type WorkerStatus,
  type WorkerTransitionError,
} from '@dw/core';
import {
  type CompanyTx,
  onWorkerActivated,
  onWorkerOffboarded,
  workerPromotionRequests,
  workers,
} from '@dw/db';
import { eq, sql } from '@dw/db/drizzle';
import { denied, notFound, type Outcome, ok, rejected } from '../org/outcome.ts';
import { type FreshActor, workerActor } from './people.ts';
import {
  lifecycleState,
  loadWorker,
  type PendingProposal,
  pendingProposal,
  recordWorkerEvent,
  type WorkerRow,
} from './store.ts';

function failure(error: WorkerTransitionError): Outcome<never> {
  if (error === WORKER_ERRORS.forbidden) return denied('FORBIDDEN');
  return rejected(WORKER_ERROR_HTTP[error] as 400 | 409, error);
}

type Locked = { actor: FreshActor; worker: WorkerRow; pending: PendingProposal | null };

/**
 * Actor (members row FOR SHARE), then worker and pending proposal FOR UPDATE, then the
 * state machine (design D3). A second concurrent request waits on the row lock and then
 * sees the new status, so `expectedStatus` turns it into 409 STATUS_CHANGED.
 */
async function decide(
  tx: CompanyTx,
  member: { readonly memberId: string },
  id: string,
  event: WorkerEvent,
  input: Parameters<typeof decideTransition>[3],
): Promise<Outcome<Locked>> {
  const actor = await workerActor(tx, member);
  if (!actor) return denied('FORBIDDEN');
  const worker = await loadWorker(tx, id, 'update');
  if (!worker) return notFound;
  const pending = await pendingProposal(tx, id, 'update');
  const decision = decideTransition(actor, lifecycleState(worker, pending), event, input);
  return decision.ok ? ok({ actor, worker, pending }) : failure(decision.error);
}

function closeProposal(
  tx: CompanyTx,
  proposal: PendingProposal,
  status: 'approved' | 'returned' | 'closed',
  actor: FreshActor,
  returnReason: string | null = null,
) {
  return tx
    .update(workerPromotionRequests)
    .set({ status, decidedByMemberId: actor.memberId, decidedAt: sql`now()`, returnReason })
    .where(eq(workerPromotionRequests.id, proposal.id));
}

/** POST /api/workers/:id/transitions (design D3). */
export async function transitionWorker(
  tx: CompanyTx,
  member: { readonly memberId: string },
  id: string,
  input: TransitionRequest,
  now: Date,
): Promise<Outcome<{ id: string; status: WorkerStatus }>> {
  const decided = await decide(tx, member, id, input.event, input);
  if (!decided.ok) return decided;
  const { actor, worker, pending } = decided.value;
  const to = (
    {
      startProbation: 'probation',
      activate: 'active',
      suspend: 'suspended',
      resume: 'active',
      offboard: 'offboarded',
    } as const
  )[input.event];

  const set: Partial<typeof workers.$inferInsert> = {
    status: to,
    statusChangedAt: now,
    revision: worker.revision + 1,
    updatedAt: now,
  };
  const fields = ['status'];
  let requestId: string | null = null;
  if (input.event === 'startProbation') {
    const period = newProbation(now);
    set.probationStartedOn = period.startedOn;
    set.probationEndsOn = period.endsOn;
  }
  if (input.event === 'activate') {
    const budget = activationBudget(worker.monthlyBudgetVnd);
    if (budget !== worker.monthlyBudgetVnd) {
      set.monthlyBudgetVnd = budget;
      fields.push('monthly_budget_vnd');
    }
    if (pending) {
      await closeProposal(tx, pending, 'approved', actor);
      requestId = pending.id;
    }
  }
  if (input.event === 'offboard') {
    set.offboardedAt = now;
    if (pending) await closeProposal(tx, pending, 'closed', actor);
  }

  await tx.update(workers).set(set).where(eq(workers.id, id));
  await recordWorkerEvent(
    tx,
    id,
    {
      kind: 'status_changed',
      fromStatus: worker.status,
      toStatus: to,
      actorMemberId: actor.memberId,
      reason: input.reason,
      requestId,
    },
    { action: 'worker.status_changed', fields },
  );
  if (to === 'active' && input.event === 'activate')
    await onWorkerActivated(tx, id, actor.memberId);
  if (to === 'offboarded') await onWorkerOffboarded(tx, id);
  return ok({ id, status: to });
}

/** POST /api/workers/:id/promotion-request — a Manager proposes (FR-02-04, #054). */
export async function proposePromotion(
  tx: CompanyTx,
  member: { readonly memberId: string },
  id: string,
  note: string | null,
): Promise<Outcome<{ id: string; requestId: string }>> {
  const decided = await decide(tx, member, id, 'propose', {});
  if (!decided.ok) return decided;
  const { actor, worker } = decided.value;
  const [request] = await tx
    .insert(workerPromotionRequests)
    .values({
      companyId: sql`app.current_company_id()`,
      workerId: id,
      requestedByMemberId: actor.memberId,
      note,
    })
    .returning({ id: workerPromotionRequests.id });
  if (!request) throw new Error('promotion request insert returned nothing');
  await recordWorkerEvent(
    tx,
    id,
    {
      kind: 'proposed',
      fromStatus: worker.status,
      toStatus: worker.status,
      actorMemberId: actor.memberId,
      requestId: request.id,
    },
    { action: 'worker.promotion_requested' },
  );
  return ok({ id, requestId: request.id });
}

/** POST /api/workers/:id/promotion-request/return — Owner / Admin, reason required. */
export async function returnPromotion(
  tx: CompanyTx,
  member: { readonly memberId: string },
  id: string,
  reason: string,
): Promise<Outcome<{ id: string }>> {
  const decided = await decide(tx, member, id, 'returnProposal', { reason });
  if (!decided.ok) return decided;
  const { actor, worker, pending } = decided.value;
  if (!pending) return rejected(409, WORKER_ERRORS.noPendingProposal);
  await closeProposal(tx, pending, 'returned', actor, reason);
  await recordWorkerEvent(
    tx,
    id,
    {
      kind: 'proposal_returned',
      fromStatus: worker.status,
      toStatus: worker.status,
      actorMemberId: actor.memberId,
      reason,
      requestId: pending.id,
    },
    { action: 'worker.promotion_returned' },
  );
  return ok({ id });
}

/** POST /api/workers/:id/probation/extend — 7 or 14 more days (0.2 #107). */
export async function extendProbation(
  tx: CompanyTx,
  member: { readonly memberId: string },
  id: string,
  days: ProbationExtension,
): Promise<Outcome<{ id: string; endsOn: string }>> {
  const decided = await decide(tx, member, id, 'extendProbation', {});
  if (!decided.ok) return decided;
  const { actor, worker } = decided.value;
  const endsOn = addDays(worker.probationEndsOn ?? newProbation(new Date()).endsOn, days);
  await tx
    .update(workers)
    .set({ probationEndsOn: endsOn, revision: worker.revision + 1, updatedAt: new Date() })
    .where(eq(workers.id, id));
  await recordWorkerEvent(
    tx,
    id,
    {
      kind: 'probation_extended',
      fromStatus: worker.status,
      toStatus: worker.status,
      actorMemberId: actor.memberId,
      days,
    },
    { action: 'worker.probation_extended', fields: ['probation_ends_on'] },
  );
  return ok({ id, endsOn });
}
