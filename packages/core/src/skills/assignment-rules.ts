import { can, type Role } from '../access/permissions.ts';
import type { WorkerStatus } from '../workers/lifecycle.ts';

/**
 * Who may give a skill to a worker and whether it needs Owner / Admin approval
 * (design D8, 0.2 #057, #058, #088). Pure: the api always calls it, the web uses it
 * only to pick which notice to show.
 */

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const WORKER_SKILL_STATUSES = ['active', 'pending', 'suspended'] as const;
export type WorkerSkillStatus = (typeof WORKER_SKILL_STATUSES)[number];

export const ASSIGNMENT_ERRORS = {
  forbidden: 'FORBIDDEN',
  skillArchived: 'SKILL_ARCHIVED',
  skillNotApproved: 'SKILL_NOT_APPROVED',
  skillNeedsReview: 'SKILL_NEEDS_REVIEW',
  workerOffboarded: 'WORKER_OFFBOARDED',
  alreadyAssigned: 'ALREADY_ASSIGNED',
} as const;
export type AssignmentError = (typeof ASSIGNMENT_ERRORS)[keyof typeof ASSIGNMENT_ERRORS];

export const ASSIGNMENT_ERROR_HTTP: Readonly<Record<AssignmentError, 403 | 409>> = {
  FORBIDDEN: 403,
  SKILL_ARCHIVED: 409,
  SKILL_NOT_APPROVED: 409,
  SKILL_NEEDS_REVIEW: 409,
  WORKER_OFFBOARDED: 409,
  ALREADY_ASSIGNED: 409,
};

export interface AssignmentActor {
  readonly role: Role;
  readonly departmentId: string | null;
}

export interface AssignmentWorker {
  readonly status: WorkerStatus;
  readonly departmentId: string;
}

export interface AssignmentSkill {
  readonly archived: boolean;
  /** Has a version in use (`current_version_id`). */
  readonly approved: boolean;
  /** The version in use has `scripts/`. */
  readonly hasScripts: boolean;
  /** This worker already has (or waits for) this skill. */
  readonly alreadyAssigned: boolean;
}

export type AssignmentDecision = 'grant' | 'request' | { readonly error: AssignmentError };

/** May `actor` give or remove skills on `worker` at all (matrix row "Giao / gỡ skill")? */
export function canAssignSkills(actor: AssignmentActor, worker: { departmentId: string }): boolean {
  const scope = can(actor.role, 'skill.assign');
  if (scope === 'all') return true;
  if (scope === 'own-department') return actor.departmentId === worker.departmentId;
  return false;
}

const ACTIVE_LIKE: ReadonlySet<WorkerStatus> = new Set(['active', 'suspended']);

export function decideAssignment(
  actor: AssignmentActor,
  worker: AssignmentWorker,
  skill: AssignmentSkill,
): AssignmentDecision {
  if (!canAssignSkills(actor, worker)) return { error: ASSIGNMENT_ERRORS.forbidden };
  if (skill.archived) return { error: ASSIGNMENT_ERRORS.skillArchived };
  if (!skill.approved) return { error: ASSIGNMENT_ERRORS.skillNotApproved };
  if (worker.status === 'offboarded') return { error: ASSIGNMENT_ERRORS.workerOffboarded };
  if (skill.alreadyAssigned) return { error: ASSIGNMENT_ERRORS.alreadyAssigned };
  const activeLike = ACTIVE_LIKE.has(worker.status);
  if (skill.hasScripts) {
    // Until review exists (change 11) script skills never reach an active worker (#088).
    return activeLike ? { error: ASSIGNMENT_ERRORS.skillNeedsReview } : 'request';
  }
  if (!activeLike) return 'grant';
  return can(actor.role, 'skill.approve') === 'all' ? 'grant' : 'request';
}
