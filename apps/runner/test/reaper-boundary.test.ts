import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Design D9: `app.tasks_needing_attention()` is a narrow path around RLS (ids only). The
 * SQL lives in packages/db/src/tasks.ts and only apps/runner may call it.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url));

const RULES: ReadonlyArray<{ what: string; pattern: RegExp; allowed: readonly string[] }> = [
  {
    what: 'SQL of tasks_needing_attention',
    pattern: /tasks_needing_attention/,
    allowed: ['packages/db/src/tasks.ts'],
  },
  {
    what: 'call of tasksNeedingAttention',
    pattern: /tasksNeedingAttention\s*\(/,
    allowed: ['packages/db/src/', 'apps/runner/src/'],
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

describe('the reaper path stays in the runner', () => {
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

  it('finds the runner', () => {
    expect(files.some(([file]) => file === 'apps/runner/src/tasks.ts')).toBe(true);
  });

  it('has no call outside the allowed modules', () => {
    const violations = files.flatMap(([file, text]) =>
      RULES.filter(
        (rule) =>
          rule.pattern.test(text) && !rule.allowed.some((prefix) => file.startsWith(prefix)),
      ).map((rule) => `${file}: ${rule.what}`),
    );
    expect(violations).toEqual([]);
  });
});
