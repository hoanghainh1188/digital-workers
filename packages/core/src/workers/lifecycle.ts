import { type Action, can, type Role } from '../access/permissions.ts';
import { workerNameKey } from './names.ts';

/**
 * Worker state machine (design D2, FR-02-02, 0.2 #051, #053, #106). Pure: the api
 * always re-checks with it, the web uses `availableEvents` to show only allowed buttons.
 */

export const WORKER_STATUSES = ['draft', 'probation', 'active', 'suspended', 'offboarded'] as const;
export type WorkerStatus = (typeof WORKER_STATUSES)[number];

/** Display order of the actions on a profile. */
export const WORKER_EVENTS = [
  'startProbation',
  'propose',
  'activate',
  'extendProbation',
  'returnProposal',
  'suspend',
  'resume',
  'offboard',
  'editTesters',
] as const;
export type WorkerEvent = (typeof WORKER_EVENTS)[number];

/** Events that change `status` (sent to POST /api/workers/:id/transitions). */
export const STATUS_EVENTS = [
  'startProbation',
  'activate',
  'suspend',
  'resume',
  'offboard',
] as const;
export type StatusEvent = (typeof STATUS_EVENTS)[number];

export const WORKER_ERRORS = {
  forbidden: 'FORBIDDEN',
  invalidTransition: 'INVALID_TRANSITION',
  offboarded: 'WORKER_OFFBOARDED',
  statusChanged: 'STATUS_CHANGED',
  jobDescriptionRequired: 'JOB_DESCRIPTION_REQUIRED',
  reasonRequired: 'REASON_REQUIRED',
  confirmNameMismatch: 'CONFIRM_NAME_MISMATCH',
  proposalPending: 'PROPOSAL_PENDING',
  noPendingProposal: 'NO_PENDING_PROPOSAL',
} as const;
export type WorkerTransitionError = (typeof WORKER_ERRORS)[keyof typeof WORKER_ERRORS];

/** HTTP status for each error code. */
export const WORKER_ERROR_HTTP: Readonly<Record<WorkerTransitionError, 400 | 403 | 409>> = {
  FORBIDDEN: 403,
  INVALID_TRANSITION: 409,
  WORKER_OFFBOARDED: 409,
  STATUS_CHANGED: 409,
  JOB_DESCRIPTION_REQUIRED: 400,
  REASON_REQUIRED: 400,
  CONFIRM_NAME_MISMATCH: 400,
  PROPOSAL_PENDING: 409,
  NO_PENDING_PROPOSAL: 409,
};

const LIVE: readonly WorkerStatus[] = ['draft', 'probation', 'active', 'suspended'];

const PATHS: Readonly<
  Record<WorkerEvent, { from: readonly WorkerStatus[]; to: WorkerStatus | null }>
> = {
  startProbation: { from: ['draft'], to: 'probation' },
  activate: { from: ['probation'], to: 'active' },
  suspend: { from: ['active'], to: 'suspended' },
  resume: { from: ['suspended'], to: 'active' },
  offboard: { from: LIVE, to: 'offboarded' },
  propose: { from: ['probation'], to: null },
  returnProposal: { from: ['probation'], to: null },
  extendProbation: { from: ['probation'], to: null },
  editTesters: { from: LIVE, to: null },
};

/** Matrix row behind each event (§1, design D7). */
const EVENT_PERMISSION: Readonly<Record<WorkerEvent, Action>> = {
  startProbation: 'worker.startProbation',
  activate: 'worker.approve',
  returnProposal: 'worker.approve',
  propose: 'worker.propose',
  extendProbation: 'worker.suspend',
  suspend: 'worker.suspend',
  resume: 'worker.suspend',
  offboard: 'worker.suspend',
  editTesters: 'worker.suspend',
};

export interface WorkerActor {
  readonly role: Role;
  readonly departmentId: string | null;
}

export interface WorkerLifecycleState {
  readonly status: WorkerStatus;
  readonly departmentId: string;
  readonly name: string;
  readonly jobDescription: string;
  readonly hasPendingProposal: boolean;
}

export interface TransitionInput {
  /** The status the person saw; a different current status means someone else acted. */
  readonly expectedStatus?: WorkerStatus;
  readonly reason?: string | null;
  readonly confirmName?: string | null;
}

export type TransitionDecision =
  | { readonly ok: true; readonly next: { readonly status: WorkerStatus } }
  | { readonly ok: false; readonly error: WorkerTransitionError };

/** May `actor` act on a worker of `departmentId` under matrix row `action`? */
export function actorMay(actor: WorkerActor, action: Action, departmentId: string): boolean {
  const scope = can(actor.role, action);
  if (scope === 'all') return true;
  if (scope === 'own-department') return actor.departmentId === departmentId;
  return false;
}

const blank = (value: string | null | undefined): boolean => (value ?? '').trim() === '';

function dataError(
  worker: WorkerLifecycleState,
  event: WorkerEvent,
  input: TransitionInput,
): WorkerTransitionError | null {
  switch (event) {
    case 'startProbation':
      return blank(worker.jobDescription) ? WORKER_ERRORS.jobDescriptionRequired : null;
    case 'offboard':
      if (blank(input.reason)) return WORKER_ERRORS.reasonRequired;
      return workerNameKey(input.confirmName ?? '') === workerNameKey(worker.name)
        ? null
        : WORKER_ERRORS.confirmNameMismatch;
    case 'returnProposal':
      return blank(input.reason) ? WORKER_ERRORS.reasonRequired : null;
    default:
      return null;
  }
}

function proposalError(
  worker: WorkerLifecycleState,
  event: WorkerEvent,
): WorkerTransitionError | null {
  if (event === 'propose' && worker.hasPendingProposal) return WORKER_ERRORS.proposalPending;
  if (event === 'returnProposal' && !worker.hasPendingProposal) {
    return WORKER_ERRORS.noPendingProposal;
  }
  return null;
}

/**
 * Decides one event. Fixed check order — role + department scope, offboarded, stale
 * status, path, proposal state, data — so errors never reveal another department's
 * worker state and the table test stays stable.
 */
export function decideTransition(
  actor: WorkerActor,
  worker: WorkerLifecycleState,
  event: WorkerEvent,
  input: TransitionInput,
): TransitionDecision {
  if (!actorMay(actor, EVENT_PERMISSION[event], worker.departmentId)) {
    return { ok: false, error: WORKER_ERRORS.forbidden };
  }
  if (worker.status === 'offboarded') return { ok: false, error: WORKER_ERRORS.offboarded };
  if (input.expectedStatus !== undefined && input.expectedStatus !== worker.status) {
    return { ok: false, error: WORKER_ERRORS.statusChanged };
  }
  const path = PATHS[event];
  if (!path.from.includes(worker.status)) {
    return { ok: false, error: WORKER_ERRORS.invalidTransition };
  }
  const error = proposalError(worker, event) ?? dataError(worker, event, input);
  if (error) return { ok: false, error };
  return { ok: true, next: { status: path.to ?? worker.status } };
}

/** Events `actor` may start on `worker` now (data such as reasons is asked for afterwards). */
export function availableEvents(
  actor: WorkerActor,
  worker: WorkerLifecycleState,
): readonly WorkerEvent[] {
  return WORKER_EVENTS.filter((event) => {
    if (!actorMay(actor, EVENT_PERMISSION[event], worker.departmentId)) return false;
    if (worker.status === 'offboarded' || !PATHS[event].from.includes(worker.status)) return false;
    return proposalError(worker, event) === null;
  });
}
