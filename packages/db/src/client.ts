import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/all.ts';

export type Database = {
  readonly pool: pg.Pool;
  readonly db: NodePgDatabase<typeof schema>;
  readonly close: () => Promise<void>;
};

/** Creates a lazily-connecting pool; no connection is opened until the first query. */
export type DatabaseOptions = {
  readonly max?: number;
  /** Called when an idle client fails (e.g. the server restarts). Defaults to ignoring it. */
  readonly onIdleError?: (error: Error) => void;
};

export function createDatabase(connectionString: string, options: DatabaseOptions = {}): Database {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  // Without a listener, an idle-client error (e.g. DB restart) crashes the process.
  pool.on('error', options.onIdleError ?? (() => {}));
  const db = drizzle(pool, { schema });
  return Object.freeze({ pool, db, close: () => pool.end() });
}
