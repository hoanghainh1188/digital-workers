import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/index.ts';
import { startTestPostgres, type TestPostgres } from './pg.ts';

describe('database roles', () => {
  let pgTest: TestPostgres;
  let app: Database;

  beforeAll(async () => {
    pgTest = await startTestPostgres();
    app = createDatabase(pgTest.appUrl);
  });

  afterAll(async () => {
    await app?.close();
    await pgTest?.stop();
  });

  it('dw_app cannot bypass RLS and is not a superuser', async () => {
    const { rows } = await app.pool.query(
      'select rolsuper, rolbypassrls from pg_roles where rolname = current_user',
    );
    expect(rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
  });

  it('dw_app cannot create tables in public (so it never owns tables)', async () => {
    await expect(app.pool.query('create table should_fail (id int)')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('dw_app gets DML on tables created by dw_owner through default privileges', async () => {
    const owner = createDatabase(pgTest.ownerUrl, { max: 1 });
    try {
      await owner.pool.query('create table probe (id int)');
    } finally {
      await owner.close();
    }
    await app.pool.query('insert into probe values (1)');
    const { rows } = await app.pool.query('select id from probe');
    expect(rows).toEqual([{ id: 1 }]);
  });

  it('migrations were applied as dw_owner', async () => {
    const { rows } = await app.pool.query(
      "select tableowner from pg_tables where schemaname = 'drizzle' and tablename = '__drizzle_migrations'",
    );
    expect(rows).toEqual([{ tableowner: 'dw_owner' }]);
  });
});
