import { fileURLToPath } from 'node:url';
import { runNode } from '@dw/core/testing';
import { describe, expect, it } from 'vitest';

const entry = fileURLToPath(new URL('../src/main.ts', import.meta.url));

describe('api startup configuration', () => {
  it('exits non-zero without DATABASE_URL, before listening', async () => {
    const result = await runNode(entry, {});
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('DATABASE_URL: missing');
    expect(result.stdout).not.toContain('started');
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
