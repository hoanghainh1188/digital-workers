import { fileURLToPath } from 'node:url';
import { freePort, startNode } from '@dw/core/testing';
import { describe, expect, it } from 'vitest';

const entry = fileURLToPath(new URL('../src/main.ts', import.meta.url));

// Unreachable on purpose: the API must start and stay live without a database.
// No ANTHROPIC_API_KEY / OPENAI_API_KEY either: features not built yet must not block startup.
const baseEnv = {
  DATABASE_URL: 'postgres://dw_app:pw-LEAK-7731@127.0.0.1:1/dw',
  HOST: '127.0.0.1',
  BETTER_AUTH_SECRET: 'auth-secret-LEAK-0000000000000000000000',
  BETTER_AUTH_URL: 'http://localhost:5173',
  SMTP_URL: 'smtp://127.0.0.1:1',
  MAIL_FROM: 'Digital Workers <noreply@dw.test>',
};
const envWithPort = async () => ({ ...baseEnv, PORT: String(await freePort()) });

describe('api process', { timeout: 15_000 }, () => {
  it('starts without the database or model keys, logs "started" with no secret values', async () => {
    const env = await envWithPort();
    const proc = startNode(entry, env);
    try {
      await proc.waitFor('"msg":"started"');
      const { stdout, stderr } = proc.output();
      expect(stdout + stderr).not.toContain('pw-LEAK-7731');
      expect(stdout + stderr).not.toContain(baseEnv.DATABASE_URL);
      expect(stdout + stderr).not.toContain('auth-secret-LEAK');
    } finally {
      proc.child.kill('SIGKILL');
    }
  });

  it('shuts down cleanly on SIGTERM with exit code 0 within 5 seconds', async () => {
    const proc = startNode(entry, await envWithPort());
    await proc.waitFor('"msg":"started"');
    const sentAt = Date.now();
    proc.child.kill('SIGTERM');
    const result = await proc.exited;
    expect(result.code).toBe(0);
    expect(Date.now() - sentAt).toBeLessThan(5_000);
    expect(result.stdout).toContain('"msg":"stopped"');
  });
});
