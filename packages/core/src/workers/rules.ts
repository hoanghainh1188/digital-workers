import type { Role } from '../access/permissions.ts';

/** Budget and probation rules (0.2 #048, #050, #107, #108, #109; design D3, D4, D9). */

export const MAX_WORKER_BUDGET_VND = 100_000_000;
/** New workers start on the probation budget (#108). */
export const PROBATION_BUDGET_VND = 300_000;
/** Budget a worker still on the probation default gets when it goes active (#108). */
export const ACTIVE_DEFAULT_BUDGET_VND = 800_000;
/** Highest budget a Manager may set or touch (#050); a company setting comes later. */
export const MANAGER_BUDGET_CAP_VND = 2_000_000;

export const PROBATION_DAYS = 14;
export const PROBATION_EXTENSIONS = [7, 14] as const;
export type ProbationExtension = (typeof PROBATION_EXTENSIONS)[number];

export const BUDGET_ERRORS = { aboveManagerCap: 'BUDGET_ABOVE_MANAGER_CAP' } as const;

/**
 * Error when `role` changes a budget from `current` to `next`. Sending the current value
 * is not a change (the form always sends every field, #109).
 */
export function budgetError(
  role: Role,
  current: number,
  next: number,
): typeof BUDGET_ERRORS.aboveManagerCap | null {
  if (next === current || role !== 'manager') return null;
  return current > MANAGER_BUDGET_CAP_VND || next > MANAGER_BUDGET_CAP_VND
    ? BUDGET_ERRORS.aboveManagerCap
    : null;
}

/** Budget after going active: the probation default becomes the active default (#108). */
export function activationBudget(current: number): number {
  return current === PROBATION_BUDGET_VND ? ACTIVE_DEFAULT_BUDGET_VND : current;
}

const VIETNAM_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar date (YYYY-MM-DD) in Vietnam at `now`. */
export function vietnamDate(now: Date): string {
  return VIETNAM_DATE.format(now);
}

const DAY_MS = 86_400_000;
const toUtcDay = (date: string): number => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

/** `date` (YYYY-MM-DD) plus `days` calendar days. */
export function addDays(date: string, days: number): string {
  return new Date((toUtcDay(date) + days) * DAY_MS).toISOString().slice(0, 10);
}

export interface ProbationPeriod {
  readonly startedOn: string;
  /** First day after probation; extended by 7 or 14 days at a time. */
  readonly endsOn: string;
}

/** "Thử việc · ngày {day}/{total}" in Vietnam time; day 1 is the start date. */
export function probationDay(
  period: ProbationPeriod,
  now: Date,
): { readonly day: number; readonly total: number } {
  const today = toUtcDay(vietnamDate(now));
  return {
    day: today - toUtcDay(period.startedOn) + 1,
    total: toUtcDay(period.endsOn) - toUtcDay(period.startedOn),
  };
}

/** Probation has run out and nobody decided yet (#048, #114). */
export function probationExpired(period: ProbationPeriod, now: Date): boolean {
  return vietnamDate(now) >= period.endsOn;
}

/** Start of a probation that begins at `now`. */
export function newProbation(now: Date): ProbationPeriod {
  const startedOn = vietnamDate(now);
  return { startedOn, endsOn: addDays(startedOn, PROBATION_DAYS) };
}
