import { can, type Role } from '../access/permissions.ts';
import type { WorkerStatus } from '../workers/lifecycle.ts';

/** The member asking, as it is now (role and department re-read, design D7). */
export interface ChatMember {
  readonly memberId: string;
  readonly role: Role;
  readonly departmentId: string | null;
}

export interface ChatWorker {
  readonly status: WorkerStatus;
  readonly departmentId: string;
}

/**
 * Who may chat with which worker (design D7, 0.2 #119–#121):
 * - `ok`: may send work (a suspended / offboarded worker answers with a fixed notice, D5);
 * - `not_tester`: a probation worker and the member is not on its tester list (Owner too);
 * - `draft`: the worker has not started probation;
 * - `forbidden`: the role's `task.assign` scope does not reach this worker.
 */
export type ChatAccess = 'ok' | 'not_tester' | 'draft' | 'forbidden';

export function canChatWith(
  member: ChatMember,
  worker: ChatWorker,
  testerIds: readonly string[],
): ChatAccess {
  if (worker.status === 'draft') return 'draft';
  const listed = testerIds.includes(member.memberId);
  if (worker.status === 'probation') return listed ? 'ok' : 'not_tester';
  switch (can(member.role, 'task.assign')) {
    case 'all':
      return 'ok';
    case 'own-department':
      return member.departmentId === worker.departmentId ? 'ok' : 'forbidden';
    case 'assigned':
      // "Nếu được gán" = on the worker's tester / assignee list (#119).
      return listed ? 'ok' : 'forbidden';
    default:
      return 'forbidden';
  }
}
