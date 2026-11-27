import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Design D2: the Better Auth tables (schema `auth`, no RLS) may only be touched from
 * apps/api/src/auth/. Everything else reads names / emails through `member_profiles`.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url));

const ALLOWED = [
  'apps/api/src/auth/',
  // The schema module itself, and the full-schema barrel the Drizzle client needs.
  'packages/db/src/schema/auth.ts',
  'packages/db/src/schema/all.ts',
  'packages/db/src/client.ts',
  'packages/db/src/tenancy.ts',
  // members.user_id is a foreign key to auth.users; the view joins it under RLS.
  'packages/db/src/schema/tenancy.ts',
];

const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ['import of @dw/db/auth-schema', /from\s+['"]@dw\/db\/auth-schema['"]/],
  ['import of the auth schema module', /from\s+['"][^'"]*schema\/(auth|all)(\.ts)?['"]/],
  ['raw SQL on auth.* tables', /\bauth\.(users|sessions|accounts|verifications)\b/],
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'dist') return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

export function violations(files: ReadonlyArray<readonly [string, string]>): string[] {
  return files.flatMap(([file, text]) =>
    ALLOWED.some((allowed) => file.startsWith(allowed))
      ? []
      : FORBIDDEN.filter(([, pattern]) => pattern.test(text)).map(([what]) => `${file}: ${what}`),
  );
}

describe('auth.* tables are only reachable from apps/api/src/auth/', () => {
  const files = ['apps', 'packages']
    .flatMap((top) => readdirSync(join(root, top)).map((name) => join(root, top, name, 'src')))
    .filter((dir) => {
      try {
        return statSync(dir).isDirectory();
      } catch {
        return false;
      }
    })
    .flatMap(sourceFiles)
    .map(
      (path) => [relative(root, path).split(sep).join('/'), readFileSync(path, 'utf8')] as const,
    );

  it('scans the source tree', () => {
    expect(files.some(([file]) => file === 'apps/api/src/auth/auth.ts')).toBe(true);
  });

  it('no other source file imports or queries the auth tables', () => {
    expect(violations(files)).toEqual([]);
  });

  it('the check catches a stray import (self-test)', () => {
    expect(
      violations([
        ['apps/api/src/routes/x.ts', "import { users } from '@dw/db/auth-schema';"],
        ['apps/runner/src/x.ts', "import { users } from '../../packages/db/src/schema/auth.ts';"],
        ['apps/api/src/routes/y.ts', "await pool.query('select email from auth.users')"],
      ]),
    ).toHaveLength(3);
  });
});
