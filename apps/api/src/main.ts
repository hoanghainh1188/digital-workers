import type { AddressInfo } from 'node:net';
import { createLogger, describeError, loadConfigOrExit, onShutdown } from '@dw/core';
import { createDatabase } from '@dw/db';
import { startQueueInBackground } from '@dw/db/queue';
import { createMailer } from '@dw/mail';
import { buildApp } from './app.ts';
import { startChatListener } from './chat/listener.ts';
import { apiConfigSchema } from './config.ts';
import { createPlatform } from './platform.ts';
import { databaseReadiness } from './readiness.ts';

const config = loadConfigOrExit(apiConfigSchema);
const logger = createLogger(config.LOG_LEVEL);
const database = createDatabase(config.DATABASE_URL, {
  onIdleError: (error) =>
    logger.warn({ error: describeError(error) }, 'idle database client failed'),
});
const mailer = createMailer({ smtpUrl: config.SMTP_URL, from: config.MAIL_FROM });

// Sends task.start / task.run; the runner works and maintains the queues (design D2).
// Started in the background: the api starts without the database (spec service-health).
const queue = startQueueInBackground({
  connectionString: config.DATABASE_URL,
  onError: (error) => logger.error({ error: describeError(error) }, 'queue error'),
});
const platform = createPlatform({ config, database, mailer, logger, chatQueue: queue.queue });
// Runner → api events for web chat (design D3): one dedicated LISTEN connection.
const listener = startChatListener({
  connectionString: config.DATABASE_URL,
  onEvent: (event) => platform.chat.hub.dispatch(event),
  logger,
});
const databaseReady = databaseReadiness(database.pool, logger);

const app = buildApp({
  logger,
  trustProxy: config.TRUST_PROXY,
  // Not ready while LISTEN has been down for more than 30 s (design Risks).
  checkDatabase: async () => (await databaseReady()) && listener.healthy(),
  platform,
});

onShutdown(async () => {
  await app.close();
  await listener.close();
  await queue.stop(5_000);
  mailer.close();
  await database.close();
}, logger);

await app.listen({ port: config.PORT, host: config.HOST });
const { port } = app.server.address() as AddressInfo;
logger.info({ port }, 'started');
