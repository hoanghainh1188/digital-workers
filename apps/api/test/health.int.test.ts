import { createDatabase, type Database } from '@dw/db';
import { startTestPostgres, type TestPostgres } from '@dw/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { databaseReadiness } from '../src/readiness.ts';
import { captureLogger } from './log-capture.ts';

function appFor(database: Database) {
  const capture = captureLogger();
  const app = buildApp({
    logger: capture.logger,
    checkDatabase: databaseReadiness(database.pool, capture.logger),
  });
  return { app, logs: capture.text };
}

describe('health against a real PostgreSQL', () => {
  let pgTest: TestPostgres;
  const cleanup: Array<() => Promise<unknown>> = [];

  beforeAll(async () => {
    pgTest = await startTestPostgres();
  });

  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn().catch(() => {});
  });

  function track(database: Database, app: FastifyInstance) {
    cleanup.push(
      () => app.close(),
      () => database.close(),
    );
  }

  it('wrong database password → 503, log names the failure but not the secret', async () => {
    const url = new URL(pgTest.appUrl);
    url.password = 'WRONG-pw-zz9';
    const database = createDatabase(url.toString());
    const { app, logs } = appFor(database);
    track(database, app);

    const res = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(res.statusCode).toBe(503);
    expect(res.body).toBe('{"status":"unavailable"}');
    expect(logs()).toContain('database ping failed');
    expect(logs()).toContain('password authentication failed');
    expect(logs()).not.toContain('WRONG-pw-zz9');
    expect(logs()).not.toContain(url.toString());
  });

  it('ready while the database runs; 503 once it stops while /health stays 200', async () => {
    const database = createDatabase(pgTest.appUrl);
    const { app, logs } = appFor(database);
    track(database, app);

    const before = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toEqual({ status: 'ready' });

    await pgTest.stop();

    const started = Date.now();
    const after = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(after.statusCode).toBe(503);
    expect(after.body).toBe('{"status":"unavailable"}');
    expect(Date.now() - started).toBeLessThan(3_000);

    const live = await app.inject({ method: 'GET', url: '/health' });
    expect(live.statusCode).toBe(200);

    expect(logs()).not.toContain('app_test_pw');
  });
});
