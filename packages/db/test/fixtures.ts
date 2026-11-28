import { createHash, randomUUID } from 'node:crypto';
import { workerNameKey } from '@dw/core/workers';
import { eq } from 'drizzle-orm';
import type { Database } from '../src/client.ts';
import { creditAccounts, modelPrices } from '../src/schema/billing.ts';
import {
  skillBlobs,
  skills,
  skillVersionFiles,
  skillVersions,
  workerSkills,
} from '../src/schema/skills.ts';
import { companies, departments, members } from '../src/schema/tenancy.ts';
import { workers, workerTesters } from '../src/schema/workers.ts';
import { withCompany } from '../src/tenancy.ts';

/**
 * Direct-insert fixtures for integration tests below the API (packages/db, apps/runner).
 * They write through dw_app + withCompany like the application does.
 */

export type WorkerStatusFixture = 'draft' | 'probation' | 'active' | 'suspended' | 'offboarded';
export type RoleFixture = 'owner' | 'admin' | 'manager' | 'member';

export interface TenantFixture {
  readonly companyId: string;
  readonly companyName: string;
  readonly departmentId: string;
  readonly ownerMemberId: string;
}

export async function insertUser(app: Database, label: string, email?: string): Promise<string> {
  const userId = randomUUID();
  await app.pool.query(
    'insert into auth.users (id, name, email, email_verified) values ($1, $2, $3, true)',
    [userId, `Người ${label}`, email ?? `${label}-${userId}@example.com`],
  );
  return userId;
}

/** A company with an Owner, a "Kinh doanh" department and a credit account. */
export async function seedTenant(
  app: Database,
  label: string,
  options: { readonly balanceVnd?: number } = {},
): Promise<TenantFixture> {
  const userId = await insertUser(app, `owner-${label}`);
  const companyId = randomUUID();
  const companyName = `Công ty ${label}`;
  return withCompany(app, companyId, async (tx) => {
    await tx.insert(companies).values({ id: companyId, name: companyName });
    const [owner] = await tx
      .insert(members)
      .values({ companyId, userId, role: 'owner' })
      .returning({ id: members.id });
    const [dept] = await tx
      .insert(departments)
      .values({ companyId, name: 'Kinh doanh' })
      .returning({ id: departments.id });
    await tx
      .insert(creditAccounts)
      .values({ companyId, balanceVnd: options.balanceVnd ?? 100_000 });
    return {
      companyId,
      companyName,
      departmentId: dept?.id ?? '',
      ownerMemberId: owner?.id ?? '',
    };
  });
}

export async function addMember(
  app: Database,
  tenant: TenantFixture,
  role: RoleFixture,
  options: { readonly departmentId?: string | null; readonly email?: string } = {},
): Promise<string> {
  const userId = await insertUser(app, role, options.email);
  const [row] = await withCompany(app, tenant.companyId, (tx) =>
    tx
      .insert(members)
      .values({
        companyId: tenant.companyId,
        userId,
        role,
        departmentId:
          options.departmentId === undefined ? tenant.departmentId : options.departmentId,
      })
      .returning({ id: members.id }),
  );
  return row?.id ?? '';
}

export async function addWorker(
  app: Database,
  tenant: TenantFixture,
  options: {
    readonly status?: WorkerStatusFixture;
    readonly name?: string;
    readonly budgetVnd?: number;
    readonly testers?: readonly string[];
    readonly managerMemberId?: string | null;
    readonly jobDescription?: string;
  } = {},
): Promise<string> {
  const name = options.name ?? `Minh ${randomUUID().slice(0, 6)}`;
  const status = options.status ?? 'active';
  return withCompany(app, tenant.companyId, async (tx) => {
    const [row] = await tx
      .insert(workers)
      .values({
        companyId: tenant.companyId,
        departmentId: tenant.departmentId,
        name,
        nameKey: workerNameKey(name),
        monthlyBudgetVnd: options.budgetVnd ?? 800_000,
        status,
        jobDescription: options.jobDescription ?? 'Lập báo giá cho khách.',
        voicePreset: 'polite',
        managerMemberId: options.managerMemberId ?? null,
        offboardedAt: status === 'offboarded' ? new Date() : null,
        createdByMemberId: tenant.ownerMemberId,
      })
      .returning({ id: workers.id });
    const workerId = row?.id ?? '';
    for (const memberId of options.testers ?? []) {
      await tx.insert(workerTesters).values({ companyId: tenant.companyId, workerId, memberId });
    }
    return workerId;
  });
}

/** A price for `anthropic:<model>` in effect since 2026-01-01 (platform table, no RLS). */
export async function addModelPrice(app: Database, model = 'claude-sonnet-5-5'): Promise<string> {
  const [row] = await app.db
    .insert(modelPrices)
    .values({
      provider: 'anthropic',
      model,
      inputUsdMicrosPerMtok: 3_000_000,
      outputUsdMicrosPerMtok: 15_000_000,
      cacheReadUsdMicrosPerMtok: 300_000,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    })
    .onConflictDoNothing()
    .returning({ id: modelPrices.id });
  return row?.id ?? '';
}

/** A skill row (no version yet). */
export async function addSkill(
  app: Database,
  tenant: TenantFixture,
  name: string,
): Promise<string> {
  const [row] = await withCompany(app, tenant.companyId, (tx) =>
    tx
      .insert(skills)
      .values({
        companyId: tenant.companyId,
        name,
        title: name,
        createdByMemberId: tenant.ownerMemberId,
      })
      .returning({ id: skills.id }),
  );
  return row?.id ?? '';
}

const TEXT_MEDIA = 'text/markdown; charset=utf-8';

/**
 * A version with its files, taken through draft → pending (→ approved and made current
 * when `approve`), as the skill triggers require. Files: path → content (string = text).
 */
export async function addSkillVersion(
  app: Database,
  tenant: TenantFixture,
  skillId: string,
  options: {
    readonly number: number;
    readonly description: string;
    readonly files: Readonly<Record<string, string | { bytes: Buffer; mediaType: string }>>;
    readonly approve: boolean;
  },
): Promise<string> {
  return withCompany(app, tenant.companyId, async (tx) => {
    const [version] = await tx
      .insert(skillVersions)
      .values({
        companyId: tenant.companyId,
        skillId,
        number: options.number,
        title: `v${options.number}`,
        description: options.description,
        suggestedRisk: 'low',
        createdByMemberId: tenant.ownerMemberId,
      })
      .returning({ id: skillVersions.id });
    const versionId = version?.id ?? '';
    for (const [path, value] of Object.entries(options.files)) {
      const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value.bytes;
      const mediaType = typeof value === 'string' ? TEXT_MEDIA : value.mediaType;
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      await tx
        .insert(skillBlobs)
        .values({ companyId: tenant.companyId, sha256, size: bytes.length, content: bytes })
        .onConflictDoNothing();
      await tx.insert(skillVersionFiles).values({
        companyId: tenant.companyId,
        versionId,
        path,
        sha256,
        size: bytes.length,
        mediaType,
      });
    }
    await tx
      .update(skillVersions)
      .set({ status: 'pending' })
      .where(eq(skillVersions.id, versionId));
    if (options.approve) {
      await tx
        .update(skillVersions)
        .set({ status: 'approved', risk: 'low', everApproved: true })
        .where(eq(skillVersions.id, versionId));
      await tx.update(skills).set({ currentVersionId: versionId }).where(eq(skills.id, skillId));
    }
    return versionId;
  });
}

/** Points the skill at `versionId` (a rollback, as `quay lại version cũ` does). */
export async function setCurrentVersion(
  app: Database,
  tenant: TenantFixture,
  skillId: string,
  versionId: string,
): Promise<void> {
  await withCompany(app, tenant.companyId, (tx) =>
    tx.update(skills).set({ currentVersionId: versionId }).where(eq(skills.id, skillId)),
  );
}

export async function assignSkill(
  app: Database,
  tenant: TenantFixture,
  workerId: string,
  skillId: string,
  status: 'active' | 'pending' | 'suspended' = 'active',
): Promise<void> {
  await withCompany(app, tenant.companyId, (tx) =>
    tx.insert(workerSkills).values({
      companyId: tenant.companyId,
      workerId,
      skillId,
      status,
      assignedByMemberId: tenant.ownerMemberId,
    }),
  );
}
