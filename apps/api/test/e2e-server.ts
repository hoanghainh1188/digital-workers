/**
 * API process for Playwright e2e (design D11): the real app with an in-memory
 * mailer, plus GET /__e2e/emails so tests can read verification links. Never
 * used in production — apps/api/src/main.ts is the production entry.
 */
import type { AddressInfo } from 'node:net';
import { createLogger, loadConfigOrExit, onShutdown } from '@dw/core';
import { createDatabase } from '@dw/db';
import { createRecordingQueue } from '@dw/db/queue';
import { createMemoryMailer } from '@dw/mail';
import { buildApp } from '../src/app.ts';
import { apiConfigSchema } from '../src/config.ts';
import { createPlatform } from '../src/platform.ts';

const config = loadConfigOrExit(apiConfigSchema);
const logger = createLogger(config.LOG_LEVEL);
const database = createDatabase(config.DATABASE_URL);
const { mailer, sent } = createMemoryMailer();

const app = buildApp({
  logger,
  checkDatabase: async () => true,
  // Many tests sign up and invite within a minute; the limits themselves have int tests.
  platform: createPlatform({
    config,
    database,
    mailer,
    logger,
    ipRateLimit: false,
    signupLimit: { max: 1_000, windowMs: 60_000 },
    invitationLimit: { max: 1_000, windowMs: 60_000 },
    // Web chat has no screen yet (change 5b): jobs are recorded, not run.
    chatQueue: createRecordingQueue(),
  }),
});
app.get('/__e2e/emails', async (request) => {
  const to = (request.query as { to?: string }).to;
  return sent.filter((email) => email.to === to).map(({ subject, text }) => ({ subject, text }));
});

onShutdown(async () => {
  await app.close();
  await database.close();
}, logger);

await app.listen({ port: config.PORT, host: config.HOST });
logger.info({ port: (app.server.address() as AddressInfo).port }, 'started');
