import { defineConfig, devices } from '@playwright/test';

const port = 4173;
// Must match E2E_API_PORT in e2e/global-setup.ts.
const apiUrl = 'http://127.0.0.1:4310';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  timeout: 30_000,
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm build && pnpm preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    env: { API_URL: apiUrl },
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
