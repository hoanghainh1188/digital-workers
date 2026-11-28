import { PgBoss } from 'pg-boss';
import { z } from 'zod';

/**
 * Task queue on pg-boss (design D2), schema `pgboss` (installed by migration 0007). Jobs carry
 * `{ companyId, taskId }` only — never message content. pg-boss is trusted for delivery
 * and timers, not for "runs once": that is `claimTask`'s conditional UPDATE.
 */

export const QUEUE_NAMES = {
  start: 'task.start',
  run: 'task.run',
  reap: 'task.reap',
} as const;

export const taskJobSchema = z.strictObject({ companyId: z.uuid(), taskId: z.uuid() });
export type TaskJob = z.infer<typeof taskJobSchema>;

/** What api and runner send. The runner also works the queues (apps/runner). */
export interface TaskQueue {
  /** task.start after `afterMs` (the coalescing window, design D4). */
  readonly sendStart: (job: TaskJob, afterMs: number) => Promise<void>;
  readonly sendRun: (job: TaskJob) => Promise<void>;
}

export interface QueueHandle {
  readonly boss: PgBoss;
  readonly queue: TaskQueue;
  /** Stops fetching, waits up to `timeoutMs` for running handlers (design D9). */
  readonly stop: (timeoutMs: number) => Promise<void>;
}

export interface QueueOptions {
  readonly connectionString: string;
  readonly onError: (error: unknown) => void;
  /** Only the runner maintains pg-boss (expiry, archive) and runs schedules. */
  readonly supervise?: boolean;
  /** task.run may stay active this long before pg-boss expires it (> TASK_MAX_SECONDS). */
  readonly runExpireSeconds?: number;
}

export async function startQueue(options: QueueOptions): Promise<QueueHandle> {
  const supervise = options.supervise ?? false;
  const boss = new PgBoss({
    connectionString: options.connectionString,
    schema: 'pgboss',
    max: 4,
    supervise,
    schedule: supervise,
    // Tables are installed by migration 0007 as dw_owner; dw_app has DML only.
    migrate: false,
    reindex: false,
    application_name: 'dw-queue',
  });
  boss.on('error', options.onError);
  await boss.start();
  await ensureQueue(boss, QUEUE_NAMES.start, { retryLimit: 2, retryDelay: 1 });
  // No retry: a Task whose runner died is never run again (0.2 #132).
  await ensureQueue(boss, QUEUE_NAMES.run, {
    retryLimit: 0,
    expireInSeconds: options.runExpireSeconds ?? 600,
  });
  await ensureQueue(boss, QUEUE_NAMES.reap, { retryLimit: 0 });

  const queue: TaskQueue = {
    sendStart: async (job, afterMs) => {
      await boss.send(QUEUE_NAMES.start, taskJobSchema.parse(job), {
        startAfter: new Date(Date.now() + Math.max(0, afterMs)),
      });
    },
    sendRun: async (job) => {
      // No singletonKey: a second job for the same Task is harmless (claimTask runs it
      // once), while a deduplicated send could leave the next Task waiting for the reaper.
      await boss.send(QUEUE_NAMES.run, taskJobSchema.parse(job));
    },
  };
  return Object.freeze({
    boss,
    queue,
    stop: (timeoutMs: number) => boss.stop({ graceful: true, timeout: timeoutMs }),
  });
}

async function ensureQueue(
  boss: PgBoss,
  name: string,
  options: { retryLimit: number; retryDelay?: number; expireInSeconds?: number },
): Promise<void> {
  const existing = await boss.getQueue(name);
  if (existing) {
    await boss.updateQueue(name, options);
    return;
  }
  await boss.createQueue(name, options);
}

/** A queue that records jobs, for tests that do not run pg-boss. */
export function createRecordingQueue(): TaskQueue & {
  readonly starts: Array<{ job: TaskJob; afterMs: number }>;
  readonly runs: TaskJob[];
} {
  const starts: Array<{ job: TaskJob; afterMs: number }> = [];
  const runs: TaskJob[] = [];
  return {
    starts,
    runs,
    sendStart: async (job, afterMs) => {
      starts.push({ job, afterMs });
    },
    sendRun: async (job) => {
      runs.push(job);
    },
  };
}

/**
 * A queue for processes that must start without the database (apps/api, spec
 * service-health): pg-boss starts in the background and retries every `retryMs`. A send
 * before it is up throws; the caller logs it and the reaper re-sends after 2 minutes.
 */
export function startQueueInBackground(options: QueueOptions & { readonly retryMs?: number }): {
  readonly queue: TaskQueue;
  readonly stop: (timeoutMs: number) => Promise<void>;
} {
  let handle: QueueHandle | null = null;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const attempt = () => {
    if (stopped) return;
    startQueue(options).then(
      async (started) => {
        if (stopped) await started.stop(1_000);
        else handle = started;
      },
      (error: unknown) => {
        options.onError(error);
        timer = setTimeout(attempt, options.retryMs ?? 5_000);
      },
    );
  };
  attempt();
  const current = (): TaskQueue => {
    if (!handle) throw new Error('task queue not started yet');
    return handle.queue;
  };
  return {
    queue: {
      sendStart: (job, afterMs) => current().sendStart(job, afterMs),
      sendRun: (job) => current().sendRun(job),
    },
    stop: async (timeoutMs) => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await handle?.stop(timeoutMs);
    },
  };
}
