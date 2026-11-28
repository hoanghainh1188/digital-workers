import { randomUUID } from 'node:crypto';
import { createWebChannel, receiveMessage } from '@dw/channels';
import { type CoalesceWindow, DEFAULT_TASK_LIMITS, type TaskLimits } from '@dw/core';
import {
  createDatabase,
  type Database,
  openConversation,
  type TaskRow,
  taskById,
  withCompany,
} from '@dw/db';
import { createRecordingQueue } from '@dw/db/queue';
import { startTestPostgres, type TestPostgres } from '@dw/db/testing';
import { addModelPrice } from '@dw/db/testing/fixtures';
import { createGateway } from '@dw/llm';
import { createFakeModels, type FakeModels } from '@dw/llm/testing';
import { createMemoryMailer } from '@dw/mail';
import { createTaskHandlers, type TaskHandlerDeps } from '../src/tasks.ts';

/** Closes a window at once: tests that are not about grouping messages. */
export const INSTANT_WINDOW: CoalesceWindow = { gapMs: 0, maxMs: 0, maxMessages: 20 };

export type LogLine = { level: string; details: object; message: string };

export function memoryLogger() {
  const lines: LogLine[] = [];
  const at = (level: string) => (details: object, message: string) =>
    void lines.push({ level, details, message });
  return {
    lines,
    text: () => JSON.stringify(lines),
    logger: { info: at('info'), warn: at('warn'), error: at('error') },
  };
}

export async function startDatabase(): Promise<{
  pg: TestPostgres;
  app: Database;
  owner: Database;
  stop: () => Promise<void>;
}> {
  const pg = await startTestPostgres();
  const app = createDatabase(pg.appUrl, { max: 10 });
  const owner = createDatabase(pg.ownerUrl, { max: 2 });
  await addModelPrice(app);
  return {
    pg,
    app,
    owner,
    stop: async () => {
      await app.close();
      await owner.close();
      await pg.stop();
    },
  };
}

export function makeRuntime(
  app: Database,
  options: {
    readonly limits?: Partial<TaskLimits>;
    readonly window?: CoalesceWindow;
    readonly model?: string;
    readonly extra?: Partial<TaskHandlerDeps>;
  } = {},
) {
  const fake: FakeModels = createFakeModels({
    text: 'Dạ, em gửi báo giá.',
    inputTokens: 100,
    outputTokens: 50,
  });
  const log = memoryLogger();
  const queue = createRecordingQueue();
  const channel = createWebChannel(app);
  const { mailer, sent: emails } = createMemoryMailer();
  const gateway = createGateway({
    database: app,
    keys: { get: async () => 'sk-test-SECRET-KEY' },
    models: fake,
    logger: log.logger,
    maxRetries: 0,
  });
  const window = options.window ?? INSTANT_WINDOW;
  const handlers = createTaskHandlers({
    database: app,
    gateway,
    channel,
    queue,
    model: { provider: 'anthropic', id: options.model ?? 'claude-sonnet-5-5' },
    limits: { ...DEFAULT_TASK_LIMITS, ...options.limits },
    window,
    logger: log.logger,
    ...options.extra,
  });
  /** Sends a message through the same intake as the API. */
  async function say(
    companyId: string,
    workerId: string,
    memberId: string,
    text: string,
    conversationId?: string,
  ) {
    const conversation =
      conversationId ??
      (
        await withCompany(app, companyId, (tx) =>
          openConversation(tx, companyId, workerId, memberId),
        )
      ).id;
    const result = await receiveMessage(
      { database: app, queue, window, onBudgetExhausted: options.extra?.onBudgetExhausted },
      {
        companyId,
        workerId,
        memberId,
        conversationId: conversation,
        text,
        clientMessageId: randomUUID(),
        source: 'web',
      },
    );
    return { result, conversationId: conversation };
  }
  /** Runs task.start then task.run for every job recorded so far, until none is left. */
  async function drain(): Promise<void> {
    for (let round = 0; round < 50; round += 1) {
      const start = queue.starts.shift();
      if (start) {
        await handlers.start(start.job);
        continue;
      }
      const run = queue.runs.shift();
      if (run) {
        await handlers.run(run);
        continue;
      }
      return;
    }
    throw new Error('queue did not drain');
  }
  return { fake, log, queue, channel, handlers, say, drain, mailer, emails };
}

export async function taskOf(app: Database, companyId: string, taskId: string): Promise<TaskRow> {
  const task = await withCompany(app, companyId, (tx) => taskById(tx, taskId));
  if (!task) throw new Error('task not found');
  return task;
}

export async function rows<T = Record<string, unknown>>(
  app: Database,
  companyId: string,
  statement: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = await app.pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.company_id', $1, true)", [companyId]);
    const result = await client.query(statement, params);
    await client.query('commit');
    return result.rows as T[];
  } finally {
    client.release();
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
