import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Design D10: `app.platform_company_summaries()` is the second narrow path around RLS.
 * Only apps/api/src/platform/ may call it, and only routes/platform.ts may register
 * /api/platform/* routes (each one behind the onRequest platform guard).
 */
const root = fileURLToPath(new URL('../../../', import.meta.url));

const RULES: ReadonlyArray<{ what: string; pattern: RegExp; allowed: readonly string[] }> = [
  {
    what: 'call of platform_company_summaries',
    pattern: /platform_company_summaries/,
    allowed: ['apps/api/src/platform/'],
  },
  {
    what: '/api/platform route',
    pattern: /['"`]\/api\/platform\//,
    allowed: ['apps/api/src/routes/platform.ts', 'apps/web/'],
  },
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
    RULES.filter(
      (rule) => rule.pattern.test(text) && !rule.allowed.some((prefix) => file.startsWith(prefix)),
    ).map((rule) => `${file}: ${rule.what}`),
  );
}

describe('platform admin paths stay in their modules', () => {
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

  it('finds the platform module', () => {
    expect(files.some(([file]) => file === 'apps/api/src/platform/store.ts')).toBe(true);
  });

  it('no other module calls the summary function or registers platform routes', () => {
    expect(violations(files)).toEqual([]);
  });

  it('every /api/platform route uses the platform guard', () => {
    const [, text] = files.find(([file]) => file === 'apps/api/src/routes/platform.ts') ?? ['', ''];
    const routes =
      text.match(/routes\.(get|post|put|delete|patch)\(\s*'\/api\/platform\/[^']*',\s*\{[^}]*/g) ??
      [];
    expect(routes.length).toBeGreaterThanOrEqual(10);
    for (const route of routes) expect(route).toContain('onRequest');
  });

  it('the check catches strays (self-test)', () => {
    expect(
      violations([
        [
          'apps/api/src/routes/credit.ts',
          "pool.query('select * from app.platform_company_summaries()')",
        ],
        ['apps/api/src/routes/x.ts', "routes.get('/api/platform/secret', handler)"],
        ['packages/billing/src/x.ts', 'platform_company_summaries'],
      ]),
    ).toHaveLength(3);
  });
});
