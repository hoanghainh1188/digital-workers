import { fileURLToPath } from 'node:url';
import { runNode } from '@dw/core/testing';
import { describe, expect, it } from 'vitest';

const entry = fileURLToPath(new URL('../src/main.ts', import.meta.url));

const authEnv = {
  DATABASE_URL: 'postgres://dw_app:pw@127.0.0.1:1/dw',
  BETTER_AUTH_SECRET: 'x'.repeat(40),
  BETTER_AUTH_URL: 'http://localhost:5173',
  SMTP_URL: 'smtp://127.0.0.1:1',
  MAIL_FROM: 'noreply@dw.test',
};

describe('api startup configuration', () => {
  it('exits non-zero without DATABASE_URL, before listening', async () => {
    const result = await runNode(entry, {});
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('DATABASE_URL: missing');
    expect(result.stdout).not.toContain('started');
  });

  it('exits non-zero without BETTER_AUTH_SECRET and names it', async () => {
    const { BETTER_AUTH_SECRET: _omit, ...env } = authEnv;
    const result = await runNode(entry, env);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('BETTER_AUTH_SECRET: missing');
    expect(result.stdout).not.toContain('started');
  });

  it('rejects GOOGLE_CLIENT_ID without GOOGLE_CLIENT_SECRET', async () => {
    const result = await runNode(entry, { ...authEnv, GOOGLE_CLIENT_ID: 'id-only' });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('GOOGLE_CLIENT_SECRET: missing');
  });

  it('rejects GOOGLE_CLIENT_SECRET without GOOGLE_CLIENT_ID, never printing the secret', async () => {
    const result = await runNode(entry, { ...authEnv, GOOGLE_CLIENT_SECRET: 'g-secret-LEAK' });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('GOOGLE_CLIENT_ID: missing');
    expect(result.stderr).not.toContain('g-secret-LEAK');
  });

  it('exits non-zero with an invalid PORT and names it', async () => {
    const result = await runNode(entry, {
      DATABASE_URL: 'postgres://dw_app:pw@localhost:5432/dw',
      PORT: 'abc',
    });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('PORT: invalid');
  });

  it('lists every bad variable and never prints values', async () => {
    const result = await runNode(entry, {
      DATABASE_URL: 'not a url, contains hunter2',
      PORT: 'abc',
      LOG_LEVEL: 'shout',
    });
    expect(result.code).not.toBe(0);
    for (const name of ['DATABASE_URL', 'PORT', 'LOG_LEVEL']) {
      expect(result.stderr).toContain(name);
    }
    expect(result.stderr + result.stdout).not.toContain('hunter2');
    expect(result.stderr).not.toContain('shout');
  });
});
