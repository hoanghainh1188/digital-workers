import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runMigrations } from '../src/migrate.ts';

const rolesSql = fileURLToPath(new URL('../../../docker/postgres/roles.sql', import.meta.url));

const OWNER_PASSWORD = 'owner_test_pw';
const APP_PASSWORD = 'app_test_pw';

export type TestPostgres = {
  readonly container: StartedPostgreSqlContainer;
  /** dw_owner: schema owner, used for migrations and fixtures. */
  readonly ownerUrl: string;
  /** dw_app: application role, subject to RLS. */
  readonly appUrl: string;
  readonly stop: () => Promise<void>;
};

/**
 * Starts PostgreSQL 16 in Docker, applies docker/postgres/roles.sql exactly as
 * production does, then runs all migrations as dw_owner.
 */
export async function startTestPostgres(): Promise<TestPostgres> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withUsername('postgres')
    .withPassword('postgres_test')
    .withDatabase('postgres')
    .start();

  await applyRoles(container.getConnectionUri());

  const base = new URL(container.getConnectionUri());
  const urlFor = (user: string, password: string) => {
    const url = new URL(base);
    url.username = user;
    url.password = password;
    url.pathname = '/dw';
    return url.toString();
  };
  const ownerUrl = urlFor('dw_owner', OWNER_PASSWORD);
  const appUrl = urlFor('dw_app', APP_PASSWORD);

  await runMigrations(ownerUrl);

  return Object.freeze({
    container,
    ownerUrl,
    appUrl,
    stop: async () => void (await container.stop()),
  });
}

/** Executes roles.sql through node-postgres by expanding its psql-only syntax. */
async function applyRoles(superuserUrl: string): Promise<void> {
  const source = await readFile(rolesSql, 'utf8');
  const expanded = source
    .replaceAll(":'owner_password'", quote(OWNER_PASSWORD))
    .replaceAll(":'app_password'", quote(APP_PASSWORD));
  const [beforeConnect = '', afterConnect = ''] = expanded.split(/^\\connect dw\s*$/m);

  await withClient(superuserUrl, async (client) => {
    for (const statement of splitStatements(beforeConnect)) await client.query(statement);
  });
  const dwUrl = new URL(superuserUrl);
  dwUrl.pathname = '/dw';
  await withClient(dwUrl.toString(), (client) => client.query(afterConnect));
}

// CREATE DATABASE cannot run inside a multi-statement query, so send one at a time.
function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*$/m)
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
