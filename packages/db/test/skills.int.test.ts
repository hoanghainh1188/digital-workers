import { createHash, randomUUID } from 'node:crypto';
import { workerNameKey } from '@dw/core/workers';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditEvents,
  companies,
  createDatabase,
  type Database,
  departments,
  effectiveSkills,
  members,
  onWorkerActivated,
  skillBlobs,
  skills,
  skillVersionFiles,
  skillVersions,
  withCompany,
  workerSkills,
  workers,
  workersHoldingSkill,
} from '../src/index.ts';
import { startTestPostgres, type TestPostgres } from './pg.ts';

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
type WorkerStatus = 'draft' | 'probation' | 'active' | 'suspended' | 'offboarded';
type VersionStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'superseded';

describe('skill tables (dw_app, design D1, D8)', () => {
  let pgTest: TestPostgres;
  let app: Database;
  let a: Tenant;
  let b: Tenant;

  async function seedTenant(label: string): Promise<Tenant> {
    const userId = randomUUID();
    await app.pool.query('insert into auth.users (id, name, email) values ($1, $2, $3)', [
      userId,
      `User ${label}`,
      `${label}-${userId}@example.com`,
    ]);
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

  async function addWorker(tenant: Tenant, status: WorkerStatus = 'draft'): Promise<string> {
    const name = `NV ${randomUUID().slice(0, 8)}`;
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
        })
        .returning({ id: workers.id }),
    );
    return row?.id ?? '';
  }

  /** A skill with versions of the given statuses; the first approved one is current. */
  async function addSkill(
    tenant: Tenant,
    statuses: VersionStatus[],
    options: { hasScripts?: boolean } = {},
  ): Promise<{ skillId: string; versionIds: string[] }> {
    const name = `ky-nang-${randomUUID().slice(0, 8)}`;
    return withCompany(app, tenant.companyId, async (tx) => {
      const [skill] = await tx
        .insert(skills)
        .values({
          companyId: tenant.companyId,
          name,
          title: name,
          createdByMemberId: tenant.ownerMemberId,
        })
        .returning({ id: skills.id });
      const skillId = skill?.id ?? '';
      const versionIds: string[] = [];
      const risk = options.hasScripts ? 'high' : 'low';
      for (const [index, status] of statuses.entries()) {
        const [version] = await tx
          .insert(skillVersions)
          .values({
            companyId: tenant.companyId,
            skillId,
            number: index + 1,
            status,
            title: `Kỹ năng v${index + 1}`,
            description: `Mô tả v${index + 1}`,
            hasScripts: options.hasScripts ?? false,
            suggestedRisk: risk,
            risk: status === 'approved' ? risk : null,
            rejectReason: status === 'rejected' ? 'sai' : null,
            everApproved: status === 'approved',
            createdByMemberId: tenant.ownerMemberId,
          })
          .returning({ id: skillVersions.id });
        versionIds.push(version?.id ?? '');
      }
      const current = versionIds[statuses.lastIndexOf('approved')];
      if (current)
        await tx.update(skills).set({ currentVersionId: current }).where(eq(skills.id, skillId));
      return { skillId, versionIds };
    });
  }

  async function addBlob(tenant: Tenant, content: string): Promise<string> {
    const bytes = Buffer.from(content);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await withCompany(app, tenant.companyId, (tx) =>
      tx
        .insert(skillBlobs)
        .values({ companyId: tenant.companyId, sha256, size: bytes.length, content: bytes })
        .onConflictDoNothing(),
    );
    return sha256;
  }

  const fileRow = (tenant: Tenant, versionId: string, path: string, sha256: string) => ({
    companyId: tenant.companyId,
    versionId,
    path,
    sha256,
    size: 1,
    mediaType: 'text/markdown; charset=utf-8',
  });

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

  describe('frozen versions (triggers, task 3.2)', () => {
    it('files of a draft can be added and removed', async () => {
      const { versionIds } = await addSkill(a, ['draft']);
      const sha = await addBlob(a, 'draft file');
      const versionId = versionIds[0] ?? '';
      await withCompany(app, a.companyId, async (tx) => {
        await tx.insert(skillVersionFiles).values(fileRow(a, versionId, 'SKILL.md', sha));
        await tx.delete(skillVersionFiles).where(eq(skillVersionFiles.versionId, versionId));
      });
    });

    it.each(['pending', 'approved'] as const)(
      'files of a %s version cannot change',
      async (status) => {
        const { versionIds } = await addSkill(a, [status]);
        const versionId = versionIds[0] ?? '';
        const sha = await addBlob(a, `frozen ${status}`);
        expect(
          await dbError(
            withCompany(app, a.companyId, (tx) =>
              tx.insert(skillVersionFiles).values(fileRow(a, versionId, 'x.md', sha)),
            ),
          ),
        ).toMatch(/only while it is a draft/);
      },
    );

    it('deleting a file of a submitted version is refused', async () => {
      const { skillId, versionIds } = await addSkill(a, ['draft']);
      const versionId = versionIds[0] ?? '';
      const sha = await addBlob(a, 'to be frozen');
      await withCompany(app, a.companyId, async (tx) => {
        await tx.insert(skillVersionFiles).values(fileRow(a, versionId, 'SKILL.md', sha));
        await tx
          .update(skillVersions)
          .set({ status: 'pending' })
          .where(eq(skillVersions.id, versionId));
      });
      expect(
        await dbError(
          withCompany(app, a.companyId, (tx) =>
            tx.delete(skillVersionFiles).where(eq(skillVersionFiles.versionId, versionId)),
          ),
        ),
      ).toMatch(/only while it is a draft/);
      expect(skillId).toBeTruthy();
    });

    it('description of an approved version cannot change; status cannot go back', async () => {
      const { versionIds } = await addSkill(a, ['approved']);
      const versionId = versionIds[0] ?? '';
      expect(
        await dbError(
          withCompany(app, a.companyId, (tx) =>
            tx
              .update(skillVersions)
              .set({ description: 'đổi' })
              .where(eq(skillVersions.id, versionId)),
          ),
        ),
      ).toMatch(/is frozen/);
      expect(
        await dbError(
          withCompany(app, a.companyId, (tx) =>
            tx
              .update(skillVersions)
              .set({ status: 'draft' })
              .where(eq(skillVersions.id, versionId)),
          ),
        ),
      ).toMatch(/cannot go from approved to draft/);
    });

    it('one draft and one pending per skill; script versions only high risk', async () => {
      const { skillId } = await addSkill(a, ['draft']);
      const insert = (status: VersionStatus, number: number) =>
        withCompany(app, a.companyId, (tx) =>
          tx.insert(skillVersions).values({
            companyId: a.companyId,
            skillId,
            number,
            status,
            title: 't',
            description: 'd',
            suggestedRisk: 'low',
            createdByMemberId: a.ownerMemberId,
          }),
        );
      expect(await dbError(insert('draft', 2))).toMatch(/skill_versions_one_draft_uq/);
      await insert('pending', 2);
      expect(await dbError(insert('pending', 3))).toMatch(/skill_versions_one_pending_uq/);
      expect(
        await dbError(
          withCompany(app, a.companyId, (tx) =>
            tx.insert(skillVersions).values({
              companyId: a.companyId,
              skillId,
              number: 9,
              status: 'superseded',
              title: 't',
              description: 'd',
              hasScripts: true,
              suggestedRisk: 'medium',
              createdByMemberId: a.ownerMemberId,
            }),
          ),
        ),
      ).toMatch(/skill_versions_scripts_high/);
    });
  });

  describe('company isolation (raw SQL as dw_app, task 3.3)', () => {
    it('company A sees none of company B skills, versions, blobs or assignments', async () => {
      const { skillId } = await addSkill(b, ['approved']);
      await addBlob(b, 'secret of b');
      const workerB = await addWorker(b);
      await withCompany(app, b.companyId, (tx) =>
        tx.insert(workerSkills).values({
          companyId: b.companyId,
          workerId: workerB,
          skillId,
          status: 'active',
          assignedByMemberId: b.ownerMemberId,
        }),
      );
      await withCompany(app, a.companyId, async (tx) => {
        for (const table of [
          'skills',
          'skill_versions',
          'skill_blobs',
          'skill_version_files',
          'worker_skills',
        ]) {
          const { rows } = await tx.execute(
            sql`select count(*)::int as n from ${sql.identifier(table)} where company_id = ${b.companyId}`,
          );
          expect(rows[0]).toEqual({ n: 0 });
        }
      });
    });

    it('a session without a company sees nothing', async () => {
      await addSkill(a, ['approved']);
      const { rows } = await app.pool.query('select count(*)::int as n from skills');
      expect(rows[0]).toEqual({ n: 0 });
    });

    it('a version pointing at a skill of company B is refused', async () => {
      const { skillId } = await addSkill(b, ['draft']);
      expect(
        await dbError(
          withCompany(app, a.companyId, (tx) =>
            tx.insert(skillVersions).values({
              companyId: a.companyId,
              skillId,
              number: 1,
              title: 't',
              description: 'd',
              suggestedRisk: 'low',
              createdByMemberId: a.ownerMemberId,
            }),
          ),
        ),
      ).toMatch(/skill_versions_company_skill_fk/);
    });

    it('worker_skills pointing at a worker of company B is refused', async () => {
      const { skillId } = await addSkill(a, ['approved']);
      const workerB = await addWorker(b);
      expect(
        await dbError(
          withCompany(app, a.companyId, (tx) =>
            tx.insert(workerSkills).values({
              companyId: a.companyId,
              workerId: workerB,
              skillId,
              status: 'active',
              assignedByMemberId: a.ownerMemberId,
            }),
          ),
        ),
      ).toMatch(/worker_skills_company_worker_fk/);
    });

    it('current_version_id must be a version of the same skill', async () => {
      const first = await addSkill(a, ['approved']);
      const second = await addSkill(a, ['approved']);
      expect(
        await dbError(
          withCompany(app, a.companyId, (tx) =>
            tx
              .update(skills)
              .set({ currentVersionId: second.versionIds[0] ?? '' })
              .where(eq(skills.id, first.skillId)),
          ),
        ),
      ).toMatch(/skills_current_version_fk/);
    });

    it('DELETE on skills and skill_versions is refused', async () => {
      const { skillId } = await addSkill(a, ['draft']);
      for (const statement of [
        sql`delete from skill_versions where skill_id = ${skillId}`,
        sql`delete from skills where id = ${skillId}`,
      ]) {
        expect(await dbError(withCompany(app, a.companyId, (tx) => tx.execute(statement)))).toMatch(
          /permission denied/,
        );
      }
    });
  });

  describe('effectiveSkills and workersHoldingSkill (task 3.4)', () => {
    it('only active assignments of live skills, at the version in use', async () => {
      const worker = await addWorker(a, 'probation');
      const inUse = await addSkill(a, ['approved', 'pending']);
      const waiting = await addSkill(a, ['approved']);
      const suspended = await addSkill(a, ['approved']);
      const archived = await addSkill(a, ['approved']);
      await withCompany(app, a.companyId, async (tx) => {
        const row = (skillId: string, status: 'active' | 'pending' | 'suspended') => ({
          companyId: a.companyId,
          workerId: worker,
          skillId,
          status,
          assignedByMemberId: a.ownerMemberId,
        });
        await tx
          .insert(workerSkills)
          .values([
            row(inUse.skillId, 'active'),
            row(waiting.skillId, 'pending'),
            row(suspended.skillId, 'suspended'),
            row(archived.skillId, 'active'),
          ]);
        await tx
          .update(skills)
          .set({ archivedAt: new Date(), archivedByMemberId: a.ownerMemberId })
          .where(eq(skills.id, archived.skillId));
      });
      const result = await withCompany(app, a.companyId, (tx) => effectiveSkills(tx, worker));
      expect(result).toEqual([
        expect.objectContaining({
          skillId: inUse.skillId,
          versionId: inUse.versionIds[0],
          number: 1,
        }),
      ]);
    });

    it('holding workers skip offboarded workers', async () => {
      const { skillId } = await addSkill(a, ['approved']);
      const live = await addWorker(a, 'active');
      const gone = await addWorker(a, 'offboarded');
      await withCompany(app, a.companyId, (tx) =>
        tx.insert(workerSkills).values(
          [live, gone].map((workerId) => ({
            companyId: a.companyId,
            workerId,
            skillId,
            status: 'pending' as const,
            assignedByMemberId: a.ownerMemberId,
          })),
        ),
      );
      expect(await withCompany(app, a.companyId, (tx) => workersHoldingSkill(tx, skillId))).toEqual(
        [live],
      );
    });

    it('activation suspends script skills only, with an AuditEvent', async () => {
      const worker = await addWorker(a, 'probation');
      const script = await addSkill(a, ['approved'], { hasScripts: true });
      const plain = await addSkill(a, ['approved']);
      await withCompany(app, a.companyId, async (tx) => {
        await tx.insert(workerSkills).values(
          [script.skillId, plain.skillId].map((skillId) => ({
            companyId: a.companyId,
            workerId: worker,
            skillId,
            status: 'active' as const,
            assignedByMemberId: a.ownerMemberId,
          })),
        );
        await onWorkerActivated(tx, worker, a.ownerMemberId);
      });
      const rows = await withCompany(app, a.companyId, (tx) =>
        tx
          .select({ skillId: workerSkills.skillId, status: workerSkills.status })
          .from(workerSkills)
          .where(eq(workerSkills.workerId, worker)),
      );
      expect(Object.fromEntries(rows.map((r) => [r.skillId, r.status]))).toEqual({
        [script.skillId]: 'suspended',
        [plain.skillId]: 'active',
      });
      const events = await withCompany(app, a.companyId, (tx) =>
        tx
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.targetId, `${worker}:${script.skillId}`)),
      );
      expect(events.map((e) => e.action)).toEqual(['worker_skill.suspended']);
    });
  });
});
