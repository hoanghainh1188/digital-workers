import type { AddressInfo } from 'node:net';
import { createLogger, describeError, loadConfigOrExit, onShutdown } from '@dw/core';
import { createDatabase } from '@dw/db';
import { buildApp } from './app.ts';
import { apiConfigSchema } from './config.ts';
import { databaseReadiness } from './readiness.ts';

const config = loadConfigOrExit(apiConfigSchema);
const logger = createLogger(config.LOG_LEVEL);
const database = createDatabase(config.DATABASE_URL, {
  onIdleError: (error) =>
    logger.warn({ error: describeError(error) }, 'idle database client failed'),
});

const app = buildApp({
  logger,
  checkDatabase: databaseReadiness(database.pool, logger),
});

onShutdown(async () => {
  await app.close();
  await database.close();
}, logger);

await app.listen({ port: config.PORT, host: config.HOST });
const { port } = app.server.address() as AddressInfo;
logger.info({ port }, 'started');
