import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/all.ts',
  out: './migrations',
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL ?? '' },
});
