import { randomUUID } from 'node:crypto';
import { ensureCreditAccount, grantTrial } from '@dw/billing';
import { describeError } from '@dw/core';
import {
  type CompanyTx,
  companies,
  type Database,
  members,
  recordAudit,
  withCompany,
} from '@dw/db';
import { eq } from '@dw/db/drizzle';
import type { FastifyBaseLogger } from 'fastify';

export class AlreadyInCompanyError extends Error {
  constructor() {
    super('User already belongs to a company');
    this.name = 'AlreadyInCompanyError';
  }
}

export type CreatedCompany = { readonly companyId: string; readonly memberId: string };
export type CreateCompany = (input: {
  userId: string;
  name: string;
  contactPhone: string | null;
  /** Already verified (Google): the trial credit is granted right away (design D8). */
  emailVerified?: boolean;
}) => Promise<CreatedCompany>;

/**
 * Creates a company with `userId` as its first Owner, its 0đ credit account and a
 * `company.created` AuditEvent, in one transaction (design D3; change 4 D8). One
 * email = one company (0.2 #035): the UNIQUE members.user_id turns a second attempt
 * into AlreadyInCompanyError. A verified creator gets the trial credit after commit;
 * a failure there is only logged (it can be granted by hand).
 */
export function companyCreator(database: Database, logger?: FastifyBaseLogger): CreateCompany {
  return async ({ userId, name, contactPhone, emailVerified }) => {
    const companyId = randomUUID();
    const created = await insertCompany(database, companyId, { userId, name, contactPhone });
    if (emailVerified) {
      await grantTrial(database, companyId).catch((error: unknown) =>
        logger?.error({ error: describeError(error) }, 'trial credit failed'),
      );
    }
    return created;
  };
}

async function insertCompany(
  database: Database,
  companyId: string,
  input: { userId: string; name: string; contactPhone: string | null },
): Promise<CreatedCompany> {
  const { userId, name, contactPhone } = input;
  try {
    return await withCompany(database, companyId, async (tx) => {
      await tx.insert(companies).values({ id: companyId, name, contactPhone });
      await ensureCreditAccount(tx, companyId);
      const [member] = await tx
        .insert(members)
        .values({ companyId, userId, role: 'owner' })
        .returning({ id: members.id });
      if (!member) throw new Error('member insert returned no row');
      await recordAudit(tx, {
        actorMemberId: member.id,
        action: 'company.created',
        targetType: 'company',
        targetId: companyId,
      });
      return { companyId, memberId: member.id };
    });
  } catch (error) {
    if (isUniqueViolation(error, 'members_user_id_unique')) throw new AlreadyInCompanyError();
    throw error;
  }
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: { code?: string; constraint?: string } }).cause ?? error;
  const pgError = cause as { code?: string; constraint?: string };
  return pgError.code === '23505' && pgError.constraint === constraint;
}

export type CompanyView = { id: string; name: string; contactPhone: string | null };

export async function readCompany(tx: CompanyTx): Promise<CompanyView | null> {
  // RLS limits `companies` to the transaction's company: no id filter needed (or trusted).
  const [row] = await tx
    .select({ id: companies.id, name: companies.name, contactPhone: companies.contactPhone })
    .from(companies);
  return row ?? null;
}

export async function updateCompany(
  tx: CompanyTx,
  companyId: string,
  patch: { name?: string; contactPhone?: string | null },
): Promise<{ company: CompanyView; changed: string[] }> {
  const before = await readCompany(tx);
  if (!before) throw new Error('company of the current session not found');
  const changed = (['name', 'contactPhone'] as const).filter(
    (field) => patch[field] !== undefined && patch[field] !== before[field],
  );
  if (changed.length === 0) return { company: before, changed: [] };
  const [after] = await tx
    .update(companies)
    .set({ ...pick(patch, changed), updatedAt: new Date() })
    .where(eq(companies.id, companyId))
    .returning({ id: companies.id, name: companies.name, contactPhone: companies.contactPhone });
  if (!after) throw new Error('company update returned no row');
  return { company: after, changed: changed.map((field) => FIELD_NAMES[field]) };
}

const FIELD_NAMES = { name: 'name', contactPhone: 'contact_phone' } as const;

function pick<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as Pick<T, K>;
}
