import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Spec llm-gateway "Gọi SDK ngoài cổng": only packages/llm may import the AI SDK
 * (`ai`, `@ai-sdk/*`) or depend on it, so every model call is priced and charged.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url));
const ALLOWED = 'packages/llm/';
const IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](ai|ai\/[^'"]+|@ai-sdk\/[^'"]+)['"]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'dist') return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [path] : [];
  });
}

export function importViolations(files: ReadonlyArray<readonly [string, string]>): string[] {
  return files
    .filter(([file, text]) => !file.startsWith(ALLOWED) && IMPORT.test(text))
    .map(([file]) => file);
}

function workspaces(): string[] {
  return ['apps', 'packages'].flatMap((top) =>
    readdirSync(join(root, top)).map((name) => join(root, top, name)),
  );
}

describe('the AI SDK is only used inside packages/llm', () => {
  const files = workspaces()
    .flatMap((dir) => ['src', 'test', 'e2e'].map((sub) => join(dir, sub)))
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
    expect(files.some(([file]) => file === 'packages/llm/src/gateway.ts')).toBe(true);
  });

  it('no other source file imports ai or @ai-sdk/*', () => {
    expect(importViolations(files)).toEqual([]);
  });

  it('no other workspace depends on ai or @ai-sdk/*', () => {
    const offenders = workspaces()
      .filter((dir) => !relative(root, dir).split(sep).join('/').startsWith('packages/llm'))
      .filter((dir) => {
        try {
          const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          return Object.keys(deps).some((name) => name === 'ai' || name.startsWith('@ai-sdk/'));
        } catch {
          return false;
        }
      });
    expect(offenders).toEqual([]);
  });

  it('the check catches a stray import (self-test)', () => {
    expect(
      importViolations([
        ['apps/runner/src/x.ts', "import { generateText } from 'ai';"],
        ['apps/api/src/y.ts', "import { createOpenAI } from '@ai-sdk/openai';"],
        ['packages/core/src/z.ts', "const m = await import('@ai-sdk/anthropic');"],
        ['apps/api/src/ok.ts', "import { createGateway } from '@dw/llm';"],
      ]),
    ).toEqual(['apps/runner/src/x.ts', 'apps/api/src/y.ts', 'packages/core/src/z.ts']);
  });
});
