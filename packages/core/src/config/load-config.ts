import type { z } from 'zod';
import { ConfigError, type ConfigIssue } from './config-error.ts';

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * Validates `env` against `schema` and returns a frozen config object.
 * Throws ConfigError listing every bad variable at once. Reasons are built from
 * issue codes, not from Zod messages, so no input value can leak into them.
 */
export function loadConfig<S extends z.ZodType>(schema: S, env: Env): Readonly<z.output<S>> {
  const result = schema.safeParse(env);
  if (result.success) {
    return Object.freeze(result.data);
  }
  throw new ConfigError(toIssues(result.error.issues, env));
}

function toIssues(zodIssues: readonly z.core.$ZodIssue[], env: Env): ConfigIssue[] {
  const byName = new Map<string, string>();
  for (const issue of zodIssues) {
    const name = String(issue.path[0] ?? '(root)');
    if (!byName.has(name)) {
      byName.set(name, describe(issue, env[name]));
    }
  }
  return [...byName].map(([name, reason]) => ({ name, reason }));
}

function describe(issue: z.core.$ZodIssue, raw: string | undefined): string {
  if (raw === undefined || raw === '') {
    return 'missing';
  }
  switch (issue.code) {
    case 'invalid_format':
      return issue.format === 'regex'
        ? 'invalid (wrong format)'
        : `invalid (expected ${issue.format})`;
    case 'invalid_type':
      return `invalid (expected ${issue.expected})`;
    case 'invalid_value':
      return `invalid (expected one of: ${issue.values.map(String).join(', ')})`;
    case 'too_small':
    case 'too_big':
      return 'invalid (out of range)';
    default:
      return 'invalid';
  }
}
