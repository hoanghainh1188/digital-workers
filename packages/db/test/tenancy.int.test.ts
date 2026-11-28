import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  companies,
  createDatabase,
  type Database,
  memberForUser,
  members,
  recordAudit,
  withCompany,
} from '../src/index.ts';
import { runMigrations } from '../src/migrate.ts';
import { startTestPostgres, type TestPostgres } from './pg.ts';

/** Drizzle wraps driver errors ("Failed query: …"); the PostgreSQL reason is in `cause`. */
async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const { message, cause } = error as { message: string; cause?: { message?: string } };
    return `${message} ${cause?.message ?? ''}`;
  }
  throw new Error('expected the database to reject the statement');
}

type Tenant = { companyId: string; userId: string; memberId: string; email: string };

describe('tenant isolation in the database (dw_app)', () => {
  let pgTest: TestPostgres;
  let app: Database;
  let a: Tenant;
  let b: Tenant;

  async function seedTenant(label: string): Promise<Tenant> {
    const userId = randomUUID();
    const email = `${label}-${userId}@example.com`;
    await app.pool.query('insert into auth.users (id, name, email) values ($1, $2, $3)', [
      userId,
      `Owner ${label}`,
      email,
    ]);
    const companyId = randomUUID();
    const memberId = await withCompany(app, companyId, async (tx) => {
      await tx.insert(companies).values({ id: companyId, name: `Company ${label}` });
      const [row] = await tx
        .insert(members)
        .values({ companyId, userId, role: 'owner' })
        .returning({ id: members.id });
      await recordAudit(tx, {
        actorMemberId: row?.id ?? null,
        action: 'company.created',
        targetType: 'company',
        targetId: companyId,
      });
      return row?.id ?? '';
    });
    return { companyId, userId, memberId, email };
  }

  beforeAll(async () => {
    pgTest = await startTestPostgres();
    // max 1: every query reuses the same physical connection, which is what the leak test needs.
    app = createDatabase(pgTest.appUrl, { max: 1 });
    a = await seedTenant('a');
    b = await seedTenant('b');
  });

  afterAll(async () => {
    await app?.close();
    await pgTest?.stop();
  });

  it('migrations are idempotent: running them again is a no-op', async () => {
    await expect(runMigrations(pgTest.ownerUrl)).resolves.toBeUndefined();
  });

  it('dw_app can use the Better Auth tables in schema auth', async () => {
    const { rows } = await app.pool.query('select count(*)::int as n from auth.users');
    expect(rows[0].n).toBeGreaterThanOrEqual(2);
  });

  describe('raw SQL without a company set', () => {
    it.each([
      'companies',
      'members',
      'audit_events',
      'member_profiles',
      'departments',
      'invitations',
    ])('%s returns no rows', async (table) => {
      const { rows } = await app.pool.query(`select * from ${table}`);
      expect(rows).toEqual([]);
    });

    it('cannot insert a business row', async () => {
      await expect(
        app.pool.query('insert into companies (id, name) values ($1, $2)', [randomUUID(), 'X']),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('with company A set, an unfiltered SELECT only sees company A', async () => {
    const rows = await withCompany(app, a.companyId, (tx) => tx.select().from(members));
    expect(rows.map((row) => row.companyId)).toEqual([a.companyId]);
    const all = await withCompany(app, a.companyId, async (tx) =>
      (await tx.execute('select id from companies')).rows.map((row) => row.id),
    );
    expect(all).toEqual([a.companyId]);
  });

  it('with company A set, inserting a row for company B is rejected', async () => {
    await expect(
      withCompany(app, a.companyId, (tx) =>
        tx.insert(members).values({ companyId: b.companyId, userId: randomUUID(), role: 'member' }),
      ),
    ).rejects.toThrow();
    expect(
      await dbError(
        withCompany(app, a.companyId, (tx) =>
          tx.execute(
            `insert into audit_events (company_id, action, target_type) values ('${b.companyId}', 'x', 'y')`,
          ),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it('with company A set, company B rows cannot be updated or deleted (0 rows)', async () => {
    const result = await withCompany(app, a.companyId, (tx) =>
      tx.execute(`update companies set name = 'hacked' where id = '${b.companyId}'`),
    );
    expect(result.rowCount).toBe(0);
    const names = await withCompany(app, b.companyId, async (tx) =>
      (await tx.select().from(companies)).map((row) => row.name),
    );
    expect(names).toEqual(['Company b']);
  });

  it.each(['update audit_events set action = $1', 'delete from audit_events where action <> $1'])(
    'audit_events is append-only: %s is denied',
    async (statement) => {
      expect(
        await dbError(
          withCompany(app, a.companyId, (tx) =>
            tx.execute(sql.raw(statement.replace('$1', "'tampered'"))),
          ),
        ),
      ).toMatch(/permission denied/);
    },
  );

  it('the company variable does not leak into the next transaction on the same connection', async () => {
    await withCompany(app, a.companyId, async (tx) => tx.select().from(members));
    const { rows } = await app.pool.query(
      "select current_setting('app.company_id', true) as v, (select count(*)::int from members) as n",
    );
    expect(rows[0].v ?? '').toBe('');
    expect(rows[0].n).toBe(0);
  });

  it('withCompany rejects a company id that is not a uuid', async () => {
    await expect(withCompany(app, "x' or '1'='1", async () => 1)).rejects.toThrow();
  });

  describe('app.member_for_user', () => {
    it('returns only the member of the given user', async () => {
      expect(await memberForUser(app, a.userId)).toEqual({
        memberId: a.memberId,
        companyId: a.companyId,
        role: 'owner',
        status: 'active',
      });
      expect(await memberForUser(app, b.userId)).toMatchObject({ companyId: b.companyId });
      expect(await memberForUser(app, randomUUID())).toBeNull();
    });

    it('are the only SECURITY DEFINER functions dw_app may execute in schema app', async () => {
      const { rows } = await app.pool.query(
        `select p.proname, p.prosecdef, p.proconfig
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and has_function_privilege('dw_app', p.oid, 'execute')
          order by 1`,
      );
      expect(rows.map((row) => row.proname)).toEqual([
        'current_company_id',
        'invitation_by_token_hash',
        'member_for_user',
        // Platform admin totals (change add-llm-gateway-and-credit, design D10).
        'platform_company_summaries',
        // Reaper ids, apps/runner only (change add-worker-runtime-webchat, design D9).
        'tasks_needing_attention',
      ]);
      for (const name of [
        'member_for_user',
        'invitation_by_token_hash',
        'platform_company_summaries',
        'tasks_needing_attention',
      ]) {
        const definer = rows.find((row) => row.proname === name);
        expect(definer?.prosecdef).toBe(true);
        expect(definer?.proconfig).toEqual(['search_path=pg_catalog, pg_temp']);
      }
    });
  });

  describe('member_profiles view', () => {
    it('under company A shows only company A people, with name and email', async () => {
      const rows = await withCompany(
        app,
        a.companyId,
        async (tx) => (await tx.execute('select company_id, email from member_profiles')).rows,
      );
      expect(rows).toEqual([{ company_id: a.companyId, email: a.email }]);
      expect(JSON.stringify(rows)).not.toContain(b.email);
    });

    it('cannot be written through', async () => {
      expect(
        await dbError(
          withCompany(app, a.companyId, (tx) =>
            tx.execute(`update member_profiles set role = 'member'`),
          ),
        ),
      ).toMatch(/permission denied|cannot update view/);
    });
  });
});
