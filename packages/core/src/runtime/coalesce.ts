/** Grouping short messages into one Task (FR-04-07, 0.2 #124). */
export interface CoalesceWindow {
  /** A message within this long after the previous one joins the same Task. */
  readonly gapMs: number;
  /** The window closes this long after the first message, whatever happens. */
  readonly maxMs: number;
  readonly maxMessages: number;
}

export const DEFAULT_COALESCE_WINDOW: CoalesceWindow = {
  gapMs: 5_000,
  maxMs: 30_000,
  maxMessages: 20,
};

export interface CollectingTask {
  readonly firstMessageAt: Date;
  readonly lastMessageAt: Date;
  readonly messageCount: number;
}

/** May a message arriving at `now` join this collecting Task? */
export function canJoinWindow(task: CollectingTask, now: Date, window: CoalesceWindow): boolean {
  return (
    task.messageCount < window.maxMessages &&
    now.getTime() - task.lastMessageAt.getTime() <= window.gapMs &&
    now.getTime() - task.firstMessageAt.getTime() < window.maxMs
  );
}

/**
 * When the window of a collecting Task closes: `0` = close now, otherwise milliseconds
 * to wait before checking again. Times come from PostgreSQL, not the process clock.
 */
export function windowClosesIn(task: CollectingTask, now: Date, window: CoalesceWindow): number {
  if (task.messageCount >= window.maxMessages) return 0;
  const byGap = task.lastMessageAt.getTime() + window.gapMs;
  const byMax = task.firstMessageAt.getTime() + window.maxMs;
  return Math.max(0, Math.min(byGap, byMax) - now.getTime());
}
