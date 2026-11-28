import type { WorkerStatus } from '../workers/lifecycle.ts';
import type { ChatAccess } from './chat-access.ts';
import type { NoticeKind } from './notices.vi.ts';

/** What intake needs to know, read in one transaction (design D5). */
export interface IntakeSnapshot {
  readonly workerStatus: WorkerStatus;
  readonly access: ChatAccess;
  readonly balanceVnd: number;
  readonly monthSpendVnd: number;
  readonly monthlyBudgetVnd: number;
}

/**
 * - `accept`: the message becomes (part of) a Task;
 * - `notice`: store the message plus a fixed reply, no Task, no cost;
 * - `refuse`: no message at all (403 at the API, `cancelled` in the runner).
 */
export type IntakeDecision =
  | { readonly kind: 'accept' }
  | { readonly kind: 'notice'; readonly notice: NoticeKind }
  | { readonly kind: 'refuse'; readonly access: Exclude<ChatAccess, 'ok'> };

/**
 * Whether a worker takes a message as work (design D5, 0.2 #018, #129, FR-13-04). The
 * order matters: access first (never tell a stranger the worker is suspended), then the
 * worker's state, then money.
 */
export function evaluateIntake(snapshot: IntakeSnapshot): IntakeDecision {
  if (snapshot.access !== 'ok') return { kind: 'refuse', access: snapshot.access };
  if (snapshot.workerStatus === 'suspended') return { kind: 'notice', notice: 'worker_suspended' };
  if (snapshot.workerStatus === 'offboarded') {
    return { kind: 'notice', notice: 'worker_offboarded' };
  }
  if (snapshot.balanceVnd <= 0) return { kind: 'notice', notice: 'credit_exhausted' };
  if (snapshot.monthSpendVnd >= snapshot.monthlyBudgetVnd) {
    return { kind: 'notice', notice: 'budget_exhausted' };
  }
  return { kind: 'accept' };
}
