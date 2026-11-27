import { defineConfig } from 'vitest/config';

const shared = ['**/node_modules/**', '**/dist/**', 'apps/web/e2e/**'];

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'unit',
          include: [
            'apps/*/src/**/*.test.ts',
            'apps/*/test/**/*.test.ts',
            'packages/*/src/**/*.test.ts',
            'packages/*/test/**/*.test.ts',
          ],
          exclude: [...shared, '**/*.int.test.ts'],
        },
      },
      {
        test: {
          name: 'int',
          include: ['apps/*/**/*.int.test.ts', 'packages/*/**/*.int.test.ts'],
          exclude: shared,
          testTimeout: 60_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
