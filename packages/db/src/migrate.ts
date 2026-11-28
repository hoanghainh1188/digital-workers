import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client.ts';

export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/** Applies pending migrations. Must be called with the owner role's connection string. */
export async function runMigrations(
  ownerConnectionString: string,
  folder: string = migrationsFolder,
): Promise<void> {
  const database = createDatabase(ownerConnectionString, { max: 1 });
  try {
    await migrate(database.db, { migrationsFolder: folder });
  } finally {
    await database.close();
  }
}
