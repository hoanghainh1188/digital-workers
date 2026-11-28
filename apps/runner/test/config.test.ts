import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig } from '@dw/core';
import { runNode } from '@dw/core/testing';
import { describe, expect, it } from 'vitest';
import { runnerConfigSchema } from '../src/config.ts';

const entry = fileURLToPath(new URL('../src/main.ts', import.meta.url));

const validEnv = {
  DATABASE_URL: 'postgres://dw_app:pw-secret@127.0.0.1:1/dw',
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  SMTP_URL: 'smtp://127.0.0.1:1',
  MAIL_FROM: 'noreply@dw.test',
};

describe('runner startup configuration', () => {
  it('exits non-zero with an invalid LOG_LEVEL and does not echo the value', async () => {
    const result = await runNode(entry, { ...validEnv, LOG_LEVEL: 'very-loud-secretish' });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('LOG_LEVEL: invalid');
    expect(result.stderr).not.toContain('very-loud-secretish');
  });

  it('names every missing variable once, without printing any value (spec runtime-config)', async () => {
    const result = await runNode(entry, { ENCRYPTION_KEY: validEnv.ENCRYPTION_KEY });
    expect(result.code).not.toBe(0);
    expect(result.stderr.match(/DATABASE_URL: missing/g)).toHaveLength(1);
    expect(result.stderr).toContain('SMTP_URL: missing');
    expect(result.stderr).not.toContain(validEnv.ENCRYPTION_KEY);
    expect(result.stdout).not.toContain('started');
  });

  it('uses the documented defaults (0.2 #123, #131)', () => {
    const config = loadConfig(runnerConfigSchema, validEnv);
    expect(config.WORKER_MODEL).toEqual({ provider: 'anthropic', id: 'claude-sonnet-5-5' });
    expect(config.RUNNER_CONCURRENCY).toBe(4);
    expect(config.TASK_MAX_STEPS).toBe(12);
    expect(config.TASK_MAX_SECONDS).toBe(180);
    expect(config.TASK_MAX_CHARGE_VND).toBe(8000);
  });

  it('rejects a model without provider and a zero limit, naming only the variables', () => {
    const run = () =>
      loadConfig(runnerConfigSchema, { ...validEnv, WORKER_MODEL: 'gpt', TASK_MAX_STEPS: '0' });
    expect(run).toThrow(ConfigError);
    try {
      run();
    } catch (error) {
      const text = String((error as Error).message);
      expect(text).toContain('WORKER_MODEL');
      expect(text).toContain('TASK_MAX_STEPS');
      expect(text).not.toContain('pw-secret');
    }
  });
});
