import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConfigError } from './config-error.ts';
import { envFields } from './env-fields.ts';
import { loadConfig } from './load-config.ts';

const schema = z.object({
  DATABASE_URL: envFields.databaseUrl,
  PORT: envFields.port(3000),
  LOG_LEVEL: envFields.logLevel,
  ANTHROPIC_API_KEY: z.string().optional(),
});

const valid = { DATABASE_URL: 'postgres://dw_app:secret@localhost:5432/dw' };

function issuesOf(env: Record<string, string | undefined>) {
  try {
    loadConfig(schema, env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
  }
  throw new Error('expected ConfigError');
}

describe('loadConfig', () => {
  it('returns parsed, defaulted and frozen config when env is valid', () => {
    const config = loadConfig(schema, valid);
    expect(config).toEqual({ ...valid, PORT: 3000, LOG_LEVEL: 'info' });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('reports a missing required variable', () => {
    const error = issuesOf({});
    expect(error.issues).toEqual([{ name: 'DATABASE_URL', reason: 'missing' }]);
  });

  it('treats an empty string as missing', () => {
    expect(issuesOf({ DATABASE_URL: '' }).issues[0]?.reason).toBe('missing');
  });

  it('reports an invalid value', () => {
    const error = issuesOf({ ...valid, PORT: 'abc' });
    expect(error.issues).toEqual([{ name: 'PORT', reason: 'invalid (wrong format)' }]);
  });

  it('treats a blank PORT as unset so the default applies', () => {
    expect(loadConfig(schema, { ...valid, PORT: '' }).PORT).toBe(3000);
  });

  it.each(['0', '0x10', '1e3', ' 80', '70000'])('rejects PORT=%j', (port) => {
    expect(issuesOf({ ...valid, PORT: port }).issues[0]?.name).toBe('PORT');
  });

  it('collects every bad variable in one error', () => {
    const error = issuesOf({ PORT: 'abc', LOG_LEVEL: 'loud' });
    expect(error.issues.map((issue) => issue.name).sort()).toEqual([
      'DATABASE_URL',
      'LOG_LEVEL',
      'PORT',
    ]);
    expect(error.message).toContain('DATABASE_URL: missing');
    expect(error.message).toContain('PORT: invalid');
  });

  it('never includes the value of a bad variable', () => {
    const secret = 'mysql://root:hunter2-SECRET@db.internal/x';
    const error = issuesOf({ DATABASE_URL: secret });
    const text = JSON.stringify(error.issues) + error.message;
    for (const part of ['hunter2', 'SECRET', 'db.internal', 'mysql']) {
      expect(text).not.toContain(part);
    }
  });

  it('does not require optional variables of features that do not exist yet', () => {
    expect(() => loadConfig(schema, valid)).not.toThrow();
  });

  it('rejects a non-postgres database URL', () => {
    expect(issuesOf({ DATABASE_URL: 'https://example.com' }).issues[0]?.name).toBe('DATABASE_URL');
  });
});
