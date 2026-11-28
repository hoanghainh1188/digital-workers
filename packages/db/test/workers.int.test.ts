import { randomUUID } from 'node:crypto';
import { workerNameKey } from '@dw/core/workers';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  companies,
  createDatabase,
  type Database,
  departments,
  members,
  withCompany,
  workerRuntimeState,
  workerStatusEvents,
  workers,
  workerTesters,
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
type Status = 'draft' | 'probation' | 'active' | 'suspended' | 'offboarded';

describe('worker tables (dw_app, design D1, D8)', () => {
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

  async function addWorker(
    tenant: Tenant,
    name: string,
    status: Status = 'draft',
    extra: Partial<typeof workers.$inferInsert> = {},
  ): Promise<string> {
    const [row] = await withCompany(app, tenant.companyId, (tx) =>
      tx
        .insert(workers)
        .values({
          companyId: tenant.companyId,
          departmentId: tenant.departmentId,
          name,
          nameKey: workerNameKey(name),
          monthlyBudgetVnd: 300_000,
          status,
          offboardedAt: status === 'offboarded' ? new Date() : null,
          createdByMemberId: tenant.ownerMemberId,
          ...extra,
        })
        .returning({ id: workers.id }),
    );
    return row?.id ?? '';
  }

  beforeAll(async () => {
    pgTest = await startTestPostgres();
    app = createDatabase(pgTest.appUrl, { max: 4 });
    a = await seedTenant('a');
    b = await seedTenant('b');
  });

  afterAll(async () => {
    await app?.close();
    await pgTest?.stop();
  });

  describe('append-only and no deletes', () => {
    it('dw_app cannot UPDATE or DELETE worker_status_events', async () => {
      const workerId = await addWorker(a, `Lịch sử ${randomUUID().slice(0, 8)}`);
      await withCompany(app, a.companyId, (tx) =>
        tx.insert(workerStatusEvents).values({
          companyId: a.companyId,
          workerId,
          kind: 'created',
          toStatus: 'draft',
          actorMemberId: a.ownerMemberId,
        }),
      );
      expect(
        await dbError(
          withCompany(app, a.companyId, (tx) =>
            tx.execute(sql`update worker_status_events set reason = 'x'`),
          ),
        ),
      ).toMatch(/permission denied/);
      expect(
        await dbError(
          withCompany(app, a.companyId, (tx) => tx.execute(sql`delete from worker_status_events`)),
        ),
      ).toMatch(/permission denied/);
    });

    it('dw_app cannot DELETE workers', async () => {
      const workerId = await addWorker(a, `Xoá ${randomUUID().slice(0, 8)}`);
      expect(
        await dbError(
          withCompany(app, a.companyId, (tx) =>
            tx.execute(sql`delete from workers where id = ${workerId}`),
          ),
        ),
      ).toMatch(/permission denied/);
    });

    it('an offboarded worker cannot be updated (trigger workers_offboarded_frozen)', async () => {
      const workerId = await addWorker(a, `Nghỉ ${randomUUID().slice(0, 8)}`, 'offboarded');
      expect(
        await dbError(
          withCompany(app, a.companyId, (tx) =>
            tx.execute(
              sql`update workers set status = 'active', offboarded_at = null where id = ${workerId}`,
            ),
          ),
        ),
      ).toMatch(/is offboarded and cannot change/);
    });
  });

  describe('names (0.2 #049)', () => {
    it('a live name is unique per company, case-insensitively', async () => {
      const name = `Minh · Báo giá ${randomUUID().slice(0, 8)}`;
      await addWorker(a, name, 'active');
      expect(await dbError(addWorker(a, name.toLowerCase()))).toMatch(
        /workers_company_name_live_uq/,
      );
      await expect(addWorker(b, name)).resolves.toBeTruthy();
    });

    it('the name of an offboarded worker can be used again', async () => {
      const name = `Quang · Tin nhắn Tết ${randomUUID().slice(0, 8)}`;
      await addWorker(a, name, 'offboarded');
      await expect(addWorker(a, name)).resolves.toBeTruthy();
    });
  });

  describe('composite foreign keys and RLS', () => {
    it('a department of another company is rejected', async () => {
      expect(
        await dbError(
          addWorker(a, `Chéo ${randomUUID().slice(0, 8)}`, 'draft', {
            departmentId: b.departmentId,
          }),
        ),
      ).toMatch(/workers_company_department_fk/);
    });

    it('a manager or tester from another company is rejected', async () => {
      expect(
        await dbError(
          addWorker(a, `Chéo QL ${randomUUID().slice(0, 8)}`, 'draft', {
            managerMemberId: b.ownerMemberId,
          }),
        ),
      ).toMatch(/workers_company_manager_fk/);
      const workerId = await addWorker(a, `Chéo thử ${randomUUID().slice(0, 8)}`);
      expect(
        await dbError(
          withCompany(app, a.companyId, (tx) =>
            tx
              .insert(workerTesters)
              .values({ companyId: a.companyId, workerId, memberId: b.ownerMemberId }),
          ),
        ),
      ).toMatch(/worker_testers_company_member_fk/);
    });

    it('company B cannot read company A workers', async () => {
      const workerId = await addWorker(a, `Riêng ${randomUUID().slice(0, 8)}`);
      const seen = await withCompany(app, b.companyId, (tx) =>
        tx.select().from(workers).where(sql`${workers.id} = ${workerId}`),
      );
      expect(seen).toEqual([]);
      const { rows } = await app.pool.query('select * from workers');
      expect(rows).toEqual([]);
    });
  });

  describe('workerRuntimeState (design D8)', () => {
    it('probation takes web chat only from testers', async () => {
      const workerId = await addWorker(a, `Thử ${randomUUID().slice(0, 8)}`, 'probation');
      await withCompany(app, a.companyId, (tx) =>
        tx
          .insert(workerTesters)
          .values({ companyId: a.companyId, workerId, memberId: a.ownerMemberId }),
      );
      const state = await withCompany(app, a.companyId, (tx) => workerRuntimeState(tx, workerId));
      expect(state).toEqual({
        status: 'probation',
        acceptsRealChannels: false,
        acceptsWebChatFrom: [a.ownerMemberId],
        autoReply: null,
        monthlyBudgetVnd: 300_000,
      });
    });

    it('active takes real channels', async () => {
      const workerId = await addWorker(a, `Chính ${randomUUID().slice(0, 8)}`, 'active', {
        monthlyBudgetVnd: 800_000,
      });
      const state = await withCompany(app, a.companyId, (tx) => workerRuntimeState(tx, workerId));
      expect(state).toMatchObject({
        acceptsRealChannels: true,
        acceptsWebChatFrom: 'assigned',
        autoReply: null,
        monthlyBudgetVnd: 800_000,
      });
    });

    it.each(['suspended', 'offboarded'] as const)(
      '%s takes no work and auto-replies',
      async (status) => {
        const workerId = await addWorker(a, `${status} ${randomUUID().slice(0, 8)}`, status);
        const state = await withCompany(app, a.companyId, (tx) => workerRuntimeState(tx, workerId));
        expect(state).toMatchObject({
          status,
          acceptsRealChannels: false,
          acceptsWebChatFrom: [],
          autoReply: status,
        });
      },
    );

    it('draft takes nothing and another company sees null', async () => {
      const workerId = await addWorker(a, `Nháp ${randomUUID().slice(0, 8)}`);
      await expect(
        withCompany(app, a.companyId, (tx) => workerRuntimeState(tx, workerId)),
      ).resolves.toMatchObject({
        acceptsRealChannels: false,
        acceptsWebChatFrom: [],
        autoReply: null,
      });
      await expect(
        withCompany(app, b.companyId, (tx) => workerRuntimeState(tx, workerId)),
      ).resolves.toBeNull();
    });
  });
});
