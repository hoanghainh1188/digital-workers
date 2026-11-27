import { fileURLToPath } from 'node:url';
import { startNode } from '@dw/core/testing';
import { describe, expect, it } from 'vitest';

const entry = fileURLToPath(new URL('../src/main.ts', import.meta.url));

describe('runner process', { timeout: 15_000 }, () => {
  it('logs "started" without secrets and exits 0 on SIGTERM', async () => {
    const proc = startNode(entry, { ANTHROPIC_API_KEY: 'sk-ant-LEAK-123', LOG_LEVEL: 'info' });
    await proc.waitFor('"msg":"started"');
    proc.child.kill('SIGTERM');
    const result = await proc.exited;
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('"msg":"stopped"');
    expect(result.stdout + result.stderr).not.toContain('sk-ant-LEAK-123');
  });
});
