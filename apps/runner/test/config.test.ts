import { fileURLToPath } from 'node:url';
import { runNode } from '@dw/core/testing';
import { describe, expect, it } from 'vitest';

const entry = fileURLToPath(new URL('../src/main.ts', import.meta.url));

describe('runner startup configuration', () => {
  it('exits non-zero with an invalid LOG_LEVEL and does not echo the value', async () => {
    const result = await runNode(entry, { LOG_LEVEL: 'very-loud-secretish' });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('LOG_LEVEL: invalid');
    expect(result.stderr).not.toContain('very-loud-secretish');
  });
});
