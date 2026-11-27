import type { AddressInfo } from 'node:net';
import { createLogger, describeError, loadConfigOrExit, onShutdown } from '@dw/core';
import { createDatabase } from '@dw/db';
import { createMailer } from '@dw/mail';
import { buildApp } from './app.ts';
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

const app = buildApp({
  logger,
  trustProxy: config.TRUST_PROXY,
  checkDatabase: databaseReadiness(database.pool, logger),
  platform: createPlatform({ config, database, mailer, logger }),
});

onShutdown(async () => {
  await app.close();
  mailer.close();
  await database.close();
}, logger);

await app.listen({ port: config.PORT, host: config.HOST });
const { port } = app.server.address() as AddressInfo;
logger.info({ port }, 'started');
