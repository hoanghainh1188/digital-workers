import { type ChildProcess, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startTestPostgres } from '@dw/db/testing';

export const E2E_API_PORT = 4310;
const serverEntry = fileURLToPath(new URL('../../api/test/e2e-server.ts', import.meta.url));

/**
 * Design D11: PostgreSQL in Docker (Testcontainers) + migrations, then the API
 * with an in-memory mailer. `vite preview` (playwright webServer) proxies /api to it.
 */
export default async function globalSetup() {
  const pg = await startTestPostgres();
  const api = spawn(process.execPath, [serverEntry], {
    env: {
      PATH: process.env.PATH ?? '',
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
      DATABASE_URL: pg.appUrl,
      HOST: '127.0.0.1',
      PORT: String(E2E_API_PORT),
      BETTER_AUTH_SECRET: 'e2e-secret-that-is-long-enough-0123456789',
      BETTER_AUTH_URL: 'http://localhost:4173',
      WEB_ORIGIN: 'http://localhost:4173',
      SMTP_URL: 'smtp://127.0.0.1:1',
      MAIL_FROM: 'e2e@dw.test',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  await waitForHealth(api);
  return async () => {
    api.kill('SIGTERM');
    await pg.stop();
  };
}

async function waitForHealth(api: ChildProcess, timeoutMs = 20_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (api.exitCode !== null) throw new Error(`e2e api exited with code ${api.exitCode}`);
    const ok = await fetch(`http://127.0.0.1:${E2E_API_PORT}/health`)
      .then((response) => response.ok)
      .catch(() => false);
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('e2e api did not become healthy');
}
