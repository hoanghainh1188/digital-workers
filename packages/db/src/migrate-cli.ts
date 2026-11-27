import { envFields, loadConfigOrExit } from '@dw/core';
import { z } from 'zod';
import { runMigrations } from './migrate.ts';

const config = loadConfigOrExit(z.object({ MIGRATION_DATABASE_URL: envFields.databaseUrl }));

try {
  await runMigrations(config.MIGRATION_DATABASE_URL);
  process.stdout.write('migrations applied\n');
} catch (error) {
  // pg errors carry no connection string; message + code are enough to act on.
  const { message, code } = error as { message?: string; code?: string };
  process.stderr.write(
    `migration failed: ${message ?? 'unknown error'}${code ? ` (${code})` : ''}\n`,
  );
  process.exit(1);
}
