import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  companies,
  createDatabase,
  type Database,
  departments,
  invitationByTokenHash,
  invitations,
  members,
  migrationsFolder,
  runMigrations,
  withCompany,
} from '../src/index.ts';
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

type Tenant = { companyId: string; ownerMemberId: string; departmentId: string };

const hash = (token: string) => createHash('sha256').update(token).digest();

describe('departments, invitations and member constraints (dw_app, design D1/D4)', () => {
  let pgTest: TestPostgres;
  let app: Database;
  let a: Tenant;
  let b: Tenant;

  async function newUser(label: string): Promise<string> {
    const userId = randomUUID();
    await app.pool.query('insert into auth.users (id, name, email) values ($1, $2, $3)', [
      userId,
      `User ${label}`,
      `${label}-${userId}@example.com`,
    ]);
    return userId;
  }

  async function seedTenant(label: string): Promise<Tenant> {
    const userId = await newUser(`owner-${label}`);
    const companyId = randomUUID();
    return withCompany(app, companyId, async (tx) => {
      await tx.insert(companies).values({ id: companyId, name: `Company ${label}` });
      const [owner] = await tx
        .insert(members)
        .values({ companyId, userId, role: 'owner' })
        .returning({ id: members.id });
      const [dept] = await tx
        .insert(departments)
        .values({ companyId, name: 'Kinh doanh' })
        .returning({ id: departments.id });
      return { companyId, ownerMemberId: owner?.id ?? '', departmentId: dept?.id ?? '' };
    });
  }

  async function addMember(
    tenant: Tenant,
    role: 'manager' | 'member',
    departmentId: string | null,
  ) {
    const userId = await newUser(role);
    return withCompany(app, tenant.companyId, (tx) =>
      tx.insert(members).values({ companyId: tenant.companyId, userId, role, departmentId }),
    );
  }

  async function invite(tenant: Tenant, token: string, email = `${randomUUID()}@x.vn`) {
    const [row] = await withCompany(app, tenant.companyId, (tx) =>
      tx
        .insert(invitations)
        .values({
          companyId: tenant.companyId,
          email,
          role: 'member',
          departmentId: tenant.departmentId,
          invitedByMemberId: tenant.ownerMemberId,
          tokenHash: hash(token),
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
        })
        .returning({ id: invitations.id }),
    );
    return row?.id ?? '';
  }

  beforeAll(async () => {
    pgTest = await startTestPostgres();
    app = createDatabase(pgTest.appUrl, { max: 2 });
    a = await seedTenant('a');
    b = await seedTenant('b');
  });

  afterAll(async () => {
    await app?.close();
    await pgTest?.stop();
  });

  describe('RLS', () => {
    it('company A sees only its own departments and invitations', async () => {
      await invite(b, `b-${randomUUID()}`);
      const [depts, invites] = await withCompany(app, a.companyId, async (tx) => [
        await tx.select().from(departments),
        await tx.select().from(invitations),
      ]);
      expect(depts.map((row) => row.companyId)).toEqual([a.companyId]);
      expect(invites.every((row) => row.companyId === a.companyId)).toBe(true);
    });

    it('dw_app cannot read invitations outside withCompany', async () => {
      await invite(a, `a-${randomUUID()}`);
      const { rows } = await app.pool.query('select * from invitations');
      expect(rows).toEqual([]);
    });

    it('a department of company B cannot be created from company A', async () => {
      expect(
        await dbError(
          withCompany(app, a.companyId, (tx) =>
            tx.insert(departments).values({ companyId: b.companyId, name: 'X' }),
          ),
        ),
      ).toMatch(/row-level security/);
    });
  });

  describe('constraints', () => {
    it('members.department_id pointing at another company’s department is rejected', async () => {
      const userId = await newUser('cross');
      expect(
        await dbError(
          withCompany(app, a.companyId, (tx) =>
            tx.execute(
              `insert into members (company_id, user_id, role, department_id)
               values ('${a.companyId}', '${userId}', 'member', '${b.departmentId}')`,
            ),
          ),
        ),
      ).toMatch(/members_company_department_fk/);
    });

    it('two Managers in one department are rejected', async () => {
      const [dept] = await withCompany(app, a.companyId, (tx) =>
        tx
          .insert(departments)
          .values({ companyId: a.companyId, name: `Kho ${randomUUID()}` })
          .returning({ id: departments.id }),
      );
      await addMember(a, 'manager', dept?.id ?? null);
      expect(await dbError(addMember(a, 'manager', dept?.id ?? null))).toMatch(
        /members_department_manager_uq/,
      );
    });

    it('a Member without a department is rejected', async () => {
      expect(await dbError(addMember(a, 'member', null))).toMatch(/members_department_required/);
    });

    it('status and locked_at must agree', async () => {
      expect(
        await dbError(
          withCompany(app, a.companyId, (tx) =>
            tx.execute(`update members set status = 'locked' where id = '${a.ownerMemberId}'`),
          ),
        ),
      ).toMatch(/members_locked_at_matches/);
    });

    it('department names are unique per company among non-archived ones, case-insensitively', async () => {
      const name = `Kế toán ${randomUUID()}`;
      const create = (value: string) =>
        withCompany(app, a.companyId, (tx) =>
          tx
            .insert(departments)
            .values({ companyId: a.companyId, name: value })
            .returning({ id: departments.id }),
        );
      const [first] = await create(name);
      expect(await dbError(create(name.toUpperCase()))).toMatch(
        /departments_company_name_active_uq/,
      );
      await withCompany(app, a.companyId, (tx) =>
        tx.execute(`update departments set archived_at = now() where id = '${first?.id}'`),
      );
      await expect(create(name)).resolves.toHaveLength(1);
      // Another company may use the same name.
      await expect(
        withCompany(app, b.companyId, (tx) =>
          tx.insert(departments).values({ companyId: b.companyId, name }),
        ),
      ).resolves.toBeDefined();
    });

    it('one pending invitation per email per company', async () => {
      const email = `${randomUUID()}@x.vn`;
      await invite(a, `t1-${randomUUID()}`, email);
      expect(await dbError(invite(a, `t2-${randomUUID()}`, email))).toMatch(
        /invitations_company_email_pending_uq/,
      );
    });
  });

  describe('app.invitation_by_token_hash', () => {
    it('returns exactly the invitation of that token, with company and inviter names', async () => {
      const token = `lookup-${randomUUID()}`;
      const id = await invite(a, token);
      const found = await invitationByTokenHash(app, hash(token));
      expect(found).toMatchObject({
        id,
        companyId: a.companyId,
        companyName: 'Company a',
        inviterName: 'User owner-a',
        role: 'member',
        departmentName: 'Kinh doanh',
        departmentArchived: false,
        status: 'pending',
      });
    });

    it('returns null for an unknown token and cannot list invitations', async () => {
      expect(await invitationByTokenHash(app, hash('nope'))).toBeNull();
      // Only an exact bytea is accepted: no pattern, no "any row" argument.
      const { rows } = await app.pool.query(
        'select count(*)::int as n from app.invitation_by_token_hash(null)',
      );
      expect(rows[0].n).toBe(0);
    });
  });
});

describe('migration 0003 on a database already at change 1a', () => {
  let pgTest: TestPostgres;
  let folder: string;

  beforeAll(async () => {
    pgTest = await startTestPostgres({ migrate: false });
    folder = await mkdtemp(join(tmpdir(), 'dw-migrations-'));
    await cp(migrationsFolder, folder, { recursive: true });
    const journalPath = join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    journal.entries = journal.entries.filter((entry: { tag: string }) => entry.tag < '0003');
    await writeFile(journalPath, JSON.stringify(journal));
  });

  afterAll(async () => {
    await rm(folder, { recursive: true, force: true });
    await pgTest?.stop();
  });

  it('keeps an existing 1a Owner and adds the new columns', async () => {
    await runMigrations(pgTest.ownerUrl, folder);
    const app = createDatabase(pgTest.appUrl, { max: 1 });
    try {
      const userId = randomUUID();
      await app.pool.query('insert into auth.users (id, name, email) values ($1, $2, $3)', [
        userId,
        'Owner 1a',
        `${userId}@example.com`,
      ]);
      const companyId = randomUUID();
      await withCompany(app, companyId, async (tx) => {
        await tx.execute(`insert into companies (id, name) values ('${companyId}', 'Từ 1a')`);
        await tx.execute(
          `insert into members (company_id, user_id, role) values ('${companyId}', '${userId}', 'owner')`,
        );
      });

      await runMigrations(pgTest.ownerUrl);

      const rows = await withCompany(app, companyId, async (tx) => tx.select().from(members));
      expect(rows).toEqual([
        expect.objectContaining({
          role: 'owner',
          status: 'active',
          departmentId: null,
          lockedAt: null,
          lastSeenAt: null,
        }),
      ]);
    } finally {
      await app.close();
    }
  });
});
