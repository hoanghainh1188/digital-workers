import { createServer } from 'node:http';
import { createBudgetAlerter, createWebChannel } from '@dw/channels';
import {
  createLogger,
  DEFAULT_COALESCE_WINDOW,
  describeError,
  loadConfigOrExit,
  onShutdown,
} from '@dw/core';
import { createSecretBox } from '@dw/crypto';
import { createDatabase, ping } from '@dw/db';
import { QUEUE_NAMES, startQueue, taskJobSchema } from '@dw/db/queue';
import { createGateway, createProviderKeyStore, providerModels } from '@dw/llm';
import { createMailer } from '@dw/mail';
import { runnerConfigSchema } from './config.ts';
import { createTaskHandlers } from './tasks.ts';

const config = loadConfigOrExit(runnerConfigSchema);
const logger = createLogger(config.LOG_LEVEL);
const database = createDatabase(config.DATABASE_URL, {
  max: config.RUNNER_CONCURRENCY + 4,
  onIdleError: (error) =>
    logger.warn({ error: describeError(error) }, 'idle database client failed'),
});
const mailer = createMailer({ smtpUrl: config.SMTP_URL, from: config.MAIL_FROM });
const keys = createProviderKeyStore({ database, box: createSecretBox(config.ENCRYPTION_KEY) });
const gateway = createGateway({ database, keys, models: providerModels, logger });
const maxSeconds = config.TASK_MAX_SECONDS;

// /health/ready for the container: 503 until the queue is started and the database
// answers (task 5.1). Listens first, so a down database shows as unavailable.
let queueStarted = false;
const health = createServer((request, response) => {
  const path = request.url?.split('?')[0];
  if (path === '/health') return void response.writeHead(200).end('{"status":"ok"}');
  if (path !== '/health/ready') return void response.writeHead(404).end();
  void ping(database.pool, 2_000, () => {}).then((reachable) => {
    const ok = reachable && queueStarted;
    response
      .writeHead(ok ? 200 : 503, { 'content-type': 'application/json' })
      .end(ok ? '{"status":"ready"}' : '{"status":"unavailable"}');
  });
});
health.listen(config.HEALTH_PORT, '0.0.0.0');

const handle = await startQueue({
  connectionString: config.DATABASE_URL,
  supervise: true,
  runExpireSeconds: maxSeconds + 120,
  onError: (error) => logger.error({ error: describeError(error) }, 'queue error'),
});
const handlers = createTaskHandlers({
  database,
  gateway,
  channel: createWebChannel(database),
  queue: handle.queue,
  model: config.WORKER_MODEL,
  limits: {
    maxSteps: config.TASK_MAX_STEPS,
    maxMs: maxSeconds * 1000,
    maxChargeVnd: config.TASK_MAX_CHARGE_VND,
  },
  window: DEFAULT_COALESCE_WINDOW,
  logger,
  onBudgetExhausted: createBudgetAlerter({
    database,
    mailer,
    webOrigin: config.WEB_ORIGIN,
    logger,
  }),
});

const work = (
  name: string,
  concurrency: number,
  fn: (job: { companyId: string; taskId: string }) => Promise<void>,
) =>
  handle.boss.work(
    name,
    { localConcurrency: concurrency, batchSize: 1, pollingIntervalSeconds: 0.5 },
    async (jobs) => {
      for (const job of jobs) await fn(taskJobSchema.parse(job.data));
    },
  );
await work(QUEUE_NAMES.start, 2, handlers.start);
await work(QUEUE_NAMES.run, config.RUNNER_CONCURRENCY, handlers.run);
await handle.boss.work(QUEUE_NAMES.reap, { batchSize: 1 }, () => handlers.reap());
await handle.boss.schedule(QUEUE_NAMES.reap, '* * * * *');
queueStarted = true;

onShutdown(
  async () => {
    // Stop taking jobs; let running Tasks finish within their own time limit (0.2 #136).
    await handle.stop((maxSeconds + 10) * 1000);
    health.close();
    mailer.close();
    await database.close();
  },
  logger,
  (maxSeconds + 15) * 1000,
);

logger.info(
  { env: config.NODE_ENV, model: `${config.WORKER_MODEL.provider}:${config.WORKER_MODEL.id}` },
  'started',
);
