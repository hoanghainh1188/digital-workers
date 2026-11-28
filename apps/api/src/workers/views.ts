import {
  actorMay,
  availableEvents,
  can,
  MANAGER_BUDGET_CAP_VND,
  probationDay,
  probationExpired,
  WORKER_STATUSES,
  type WorkerEvent,
  type WorkerStatus,
} from '@dw/core';
import {
  type CompanyTx,
  departments,
  workerPromotionRequests,
  workerStatusEvents,
  workers,
  workerTesters,
} from '@dw/db';
import { and, asc, count, desc, eq, inArray, ne } from '@dw/db/drizzle';
import { denied, notFound, type Outcome, ok } from '../org/outcome.ts';
import { type FreshActor, type PersonRef, peopleById } from './people.ts';
import { lifecycleState, loadWorker, pendingProposal, type WorkerRow } from './store.ts';

/** Characters of the job description shown on an org-chart card. */
const CARD_JOB_LENGTH = 140;

export type ProbationView = {
  startedOn: string;
  endsOn: string;
  day: number;
  total: number;
  expired: boolean;
};

function probationView(worker: WorkerRow, now: Date): ProbationView | null {
  if (worker.status !== 'probation' || !worker.probationStartedOn || !worker.probationEndsOn) {
    return null;
  }
  const period = { startedOn: worker.probationStartedOn, endsOn: worker.probationEndsOn };
  return { ...period, ...probationDay(period, now), expired: probationExpired(period, now) };
}

const seesAll = (actor: FreshActor) => can(actor.role, 'worker.view') === 'all';

export type WorkerCard = {
  id: string;
  name: string;
  avatarColor: number;
  jobSummary: string;
  status: WorkerStatus;
  department: { id: string; name: string };
  manager: PersonRef | null;
  monthlyBudgetVnd: number;
  probation: ProbationView | null;
  hasPendingProposal: boolean;
};

export type WorkerList = {
  workers: WorkerCard[];
  counts: Record<WorkerStatus, number>;
  /** Live workers of departments outside the actor's scope: a count only (0.2 #047, #105). */
  otherDepartments: { departmentId: string; name: string; count: number }[];
  /** The viewer's own department, for the hire dialog's department choice. */
  myDepartmentId: string | null;
};

/**
 * GET /api/workers (design D4). Owner / Admin see every worker; others see their own
 * department and only counts for the rest — no names, no job descriptions.
 */
export async function listWorkers(
  tx: CompanyTx,
  actor: FreshActor,
  filter: { status?: WorkerStatus },
  now: Date,
): Promise<WorkerList> {
  const all = seesAll(actor);
  const ownDepartment = actor.departmentId;
  const inScope = all || ownDepartment === null ? [] : [eq(workers.departmentId, ownDepartment)];
  const rows =
    all || ownDepartment !== null
      ? await tx
          .select({ worker: workers, departmentName: departments.name })
          .from(workers)
          .innerJoin(departments, eq(departments.id, workers.departmentId))
          .where(and(...inScope))
          .orderBy(asc(workers.createdAt))
      : [];

  const counts = Object.fromEntries(WORKER_STATUSES.map((s) => [s, 0])) as Record<
    WorkerStatus,
    number
  >;
  for (const { worker } of rows) counts[worker.status] += 1;

  const shown = rows.filter(({ worker }) => !filter.status || worker.status === filter.status);
  const ids = shown.map(({ worker }) => worker.id);
  const pending =
    ids.length === 0
      ? []
      : await tx
          .select({ workerId: workerPromotionRequests.workerId })
          .from(workerPromotionRequests)
          .where(
            and(
              inArray(workerPromotionRequests.workerId, ids),
              eq(workerPromotionRequests.status, 'pending'),
            ),
          );
  const pendingIds = new Set(pending.map((row) => row.workerId));
  const people = await peopleById(
    tx,
    shown.map(({ worker }) => worker.managerMemberId),
  );

  const cards = shown.map(({ worker, departmentName }) => ({
    id: worker.id,
    name: worker.name,
    avatarColor: worker.avatarColor,
    jobSummary: worker.jobDescription.slice(0, CARD_JOB_LENGTH),
    status: worker.status,
    department: { id: worker.departmentId, name: departmentName },
    manager: worker.managerMemberId ? (people.get(worker.managerMemberId) ?? null) : null,
    monthlyBudgetVnd: worker.monthlyBudgetVnd,
    probation: probationView(worker, now),
    hasPendingProposal: pendingIds.has(worker.id),
  }));

  const otherDepartments = all
    ? []
    : await tx
        .select({ departmentId: departments.id, name: departments.name, count: count() })
        .from(workers)
        .innerJoin(departments, eq(departments.id, workers.departmentId))
        .where(
          and(
            ne(workers.status, 'offboarded'),
            ownDepartment === null ? undefined : ne(workers.departmentId, ownDepartment),
          ),
        )
        .groupBy(departments.id, departments.name)
        .orderBy(asc(departments.name));

  return { workers: cards, counts, otherDepartments, myDepartmentId: ownDepartment };
}

/** The worker if `actor` may view it: 404 outside the company, 403 outside the scope. */
export async function viewableWorker(
  tx: CompanyTx,
  actor: FreshActor,
  id: string,
): Promise<Outcome<WorkerRow>> {
  const worker = await loadWorker(tx, id);
  if (!worker) return notFound;
  if (!actorMay(actor, 'worker.view', worker.departmentId)) return denied('FORBIDDEN');
  return ok(worker);
}

export type WorkerDetail = Omit<WorkerCard, 'jobSummary' | 'hasPendingProposal'> & {
  jobDescription: string;
  voicePreset: string | null;
  voiceCustom: string | null;
  templateId: string | null;
  department: { id: string; name: string; archived: boolean };
  testers: PersonRef[];
  pendingProposal: {
    id: string;
    requestedBy: PersonRef | null;
    note: string | null;
    createdAt: Date;
  } | null;
  lastReturnedProposal: {
    requestedBy: PersonRef | null;
    decidedBy: PersonRef | null;
    reason: string | null;
    decidedAt: Date | null;
  } | null;
  revision: number;
  statusChangedAt: Date;
  offboardedAt: Date | null;
  createdAt: Date;
  /** Actions the viewer may start — the same rules the api re-checks (design D9). */
  availableEvents: readonly WorkerEvent[];
  canEdit: boolean;
  /** A Manager may not touch a budget above the cap (0.2 #109). */
  budgetLocked: boolean;
};

/** GET /api/workers/:id. */
export async function workerDetail(
  tx: CompanyTx,
  actor: FreshActor,
  id: string,
  now: Date,
): Promise<Outcome<WorkerDetail>> {
  const viewable = await viewableWorker(tx, actor, id);
  if (!viewable.ok) return viewable;
  const worker = viewable.value;
  const [department] = await tx
    .select({ name: departments.name, archivedAt: departments.archivedAt })
    .from(departments)
    .where(eq(departments.id, worker.departmentId));
  const testerRows = await tx
    .select({ memberId: workerTesters.memberId })
    .from(workerTesters)
    .where(eq(workerTesters.workerId, id))
    .orderBy(asc(workerTesters.createdAt));
  const pending = await pendingProposal(tx, id);
  const [returned] = await tx
    .select()
    .from(workerPromotionRequests)
    .where(
      and(eq(workerPromotionRequests.workerId, id), eq(workerPromotionRequests.status, 'returned')),
    )
    .orderBy(desc(workerPromotionRequests.decidedAt))
    .limit(1);
  const people = await peopleById(tx, [
    worker.managerMemberId,
    ...testerRows.map((row) => row.memberId),
    pending?.requestedByMemberId,
    returned?.requestedByMemberId,
    returned?.decidedByMemberId,
  ]);
  const person = (memberId: string | null | undefined) =>
    memberId ? (people.get(memberId) ?? null) : null;

  const canEdit =
    worker.status !== 'offboarded' && actorMay(actor, 'worker.edit', worker.departmentId);
  return ok({
    id: worker.id,
    name: worker.name,
    avatarColor: worker.avatarColor,
    jobDescription: worker.jobDescription,
    voicePreset: worker.voicePreset,
    voiceCustom: worker.voiceCustom,
    templateId: worker.templateId,
    status: worker.status,
    department: {
      id: worker.departmentId,
      name: department?.name ?? '',
      archived: Boolean(department?.archivedAt),
    },
    manager: person(worker.managerMemberId),
    testers: testerRows.flatMap((row) => person(row.memberId) ?? []),
    monthlyBudgetVnd: worker.monthlyBudgetVnd,
    probation: probationView(worker, now),
    pendingProposal: pending
      ? {
          id: pending.id,
          requestedBy: person(pending.requestedByMemberId),
          note: pending.note,
          createdAt: pending.createdAt,
        }
      : null,
    lastReturnedProposal:
      returned && worker.status === 'probation' && !pending
        ? {
            requestedBy: person(returned.requestedByMemberId),
            decidedBy: person(returned.decidedByMemberId),
            reason: returned.returnReason,
            decidedAt: returned.decidedAt,
          }
        : null,
    revision: worker.revision,
    statusChangedAt: worker.statusChangedAt,
    offboardedAt: worker.offboardedAt,
    createdAt: worker.createdAt,
    availableEvents: availableEvents(actor, lifecycleState(worker, pending)),
    canEdit,
    budgetLocked:
      canEdit && actor.role === 'manager' && worker.monthlyBudgetVnd > MANAGER_BUDGET_CAP_VND,
  });
}

export type HistoryView = {
  id: string;
  kind: (typeof workerStatusEvents.$inferSelect)['kind'];
  fromStatus: WorkerStatus | null;
  toStatus: WorkerStatus;
  actor: PersonRef | null;
  reason: string | null;
  days: number | null;
  templateId: string | null;
  /** For an approval of a proposal: who proposed. */
  proposer: PersonRef | null;
  createdAt: Date;
};

/** GET /api/workers/:id/history — newest first. */
export async function workerHistory(
  tx: CompanyTx,
  actor: FreshActor,
  id: string,
): Promise<Outcome<{ events: HistoryView[] }>> {
  const viewable = await viewableWorker(tx, actor, id);
  if (!viewable.ok) return viewable;
  const rows = await tx
    .select({ event: workerStatusEvents, requestedBy: workerPromotionRequests.requestedByMemberId })
    .from(workerStatusEvents)
    .leftJoin(workerPromotionRequests, eq(workerPromotionRequests.id, workerStatusEvents.requestId))
    .where(eq(workerStatusEvents.workerId, id))
    .orderBy(desc(workerStatusEvents.createdAt), desc(workerStatusEvents.id));
  const people = await peopleById(
    tx,
    rows.flatMap(({ event, requestedBy }) => [event.actorMemberId, requestedBy]),
  );
  return ok({
    events: rows.map(({ event, requestedBy }) => ({
      id: event.id,
      kind: event.kind,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      actor: people.get(event.actorMemberId) ?? null,
      reason: event.reason,
      days: event.days,
      templateId: event.templateId,
      proposer: requestedBy ? (people.get(requestedBy) ?? null) : null,
      createdAt: event.createdAt,
    })),
  });
}
