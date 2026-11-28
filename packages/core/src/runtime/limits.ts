/** Limits of one Task (0.2 #123): shared by every worker in the MVP. */
export interface TaskLimits {
  readonly maxSteps: number;
  readonly maxMs: number;
  readonly maxChargeVnd: number;
}

export const DEFAULT_TASK_LIMITS: TaskLimits = { maxSteps: 12, maxMs: 180_000, maxChargeVnd: 8000 };

export interface TaskProgress {
  readonly steps: number;
  readonly chargeVnd: number;
  readonly startedAtMs: number;
}

export type LimitReason = 'max_steps' | 'max_seconds' | 'max_charge';

/**
 * Checked **before** each model call (design D6), so a Task may go over the cost limit by
 * at most one call; `maxOutputTokens` bounds that call.
 */
export function checkTaskLimits(
  progress: TaskProgress,
  limits: TaskLimits,
  nowMs: number,
): LimitReason | null {
  if (progress.steps >= limits.maxSteps) return 'max_steps';
  if (nowMs - progress.startedAtMs >= limits.maxMs) return 'max_seconds';
  if (progress.chargeVnd >= limits.maxChargeVnd) return 'max_charge';
  return null;
}
