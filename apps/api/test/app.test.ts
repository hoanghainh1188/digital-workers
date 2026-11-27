import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../src/app.ts';
import type { ZodTypeProvider } from '../src/plugins/zod.ts';
import { captureLogger } from './log-capture.ts';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

function makeApp(checkDatabase: () => Promise<boolean> = async () => true) {
  const capture = captureLogger();
  const app = buildApp({ logger: capture.logger, checkDatabase });
  close = () => app.close();
  return { app, logs: capture.text };
}

describe('health routes', () => {
  it('GET /health returns 200 {status:"ok"} without credentials', async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /health stays 200 when the database is down', async () => {
    const { app } = makeApp(async () => false);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /health/ready returns 200 {status:"ready"} when the database answers', async () => {
    const { app } = makeApp(async () => true);
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready' });
  });

  it('GET /health/ready returns 503 with only {status:"unavailable"} when it does not', async () => {
    const { app } = makeApp(async () => false);
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.body).toBe('{"status":"unavailable"}');
  });
});

describe('error handling', () => {
  it('5xx responses hide internals; the detail goes to the log', async () => {
    const { app, logs } = makeApp();
    app.get('/boom', async () => {
      throw new Error('db exploded at 10.0.0.5');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    expect(res.body).not.toContain('10.0.0.5');
    expect(logs()).toContain('db exploded');
  });

  it('Zod validation failures return a 400 envelope', async () => {
    const { app } = makeApp();
    app
      .withTypeProvider<ZodTypeProvider>()
      .post('/echo', { schema: { body: z.object({ name: z.string() }) } }, async (request) => ({
        name: request.body.name,
      }));
    const res = await app.inject({ method: 'POST', url: '/echo', payload: { name: 42 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(res.json().error.details[0].path).toBe('name');
  });

  it('unknown routes return a 404 envelope', async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });
});

describe('request logging', () => {
  it('logs the path without the query string', async () => {
    const { app, logs } = makeApp();
    await app.inject({ method: 'GET', url: '/health?token=QUERY-SECRET-9' });
    expect(logs()).toContain('"url":"/health"');
    expect(logs()).not.toContain('QUERY-SECRET-9');
  });
});

describe('logger redaction', () => {
  it('masks credentials, tokens and connection strings', () => {
    const { logger, text } = captureLogger();
    logger.info(
      {
        req: { headers: { authorization: 'Bearer tok-AAA', cookie: 'sid=COOKIE-BBB' } },
        connector: { password: 'pw-CCC', token: 'tok-DDD', apiKey: 'key-EEE', secret: 'sec-FFF' },
        DATABASE_URL: 'postgres://dw_app:pw-GGG@db/dw',
      },
      'probe',
    );
    const out = text();
    for (const leaked of ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG']) {
      expect(out).not.toContain(leaked);
    }
    expect(out).toContain('[redacted]');
  });
});
