import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import type { Database } from './client.ts';
import type * as schema from './schema/all.ts';
import { auditEvents } from './schema/tenancy.ts';

type Db = NodePgDatabase<typeof schema>;

/** A transaction scoped to one company: RLS lets it see and write only that company's rows. */
export type CompanyTx = Parameters<Parameters<Db['transaction']>[0]>[0];

const companyIdSchema = z.uuid();

/**
 * Runs `fn` in a transaction with `app.company_id` set for that transaction only
 * (`set_config(..., true)`), so the value never leaks to the next user of the
 * pooled connection. This is the only way to query business tables (design D3).
 */
export async function withCompany<T>(
  database: Pick<Database, 'db'>,
  companyId: string,
  fn: (tx: CompanyTx) => Promise<T>,
): Promise<T> {
  const id = companyIdSchema.parse(companyId);
  return database.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${id}, true)`);
    return fn(tx);
  });
}

export type MemberRole = 'owner' | 'admin' | 'manager' | 'member';
export type MemberStatus = 'active' | 'locked';

export type MemberForUser = {
  readonly memberId: string;
  readonly companyId: string;
  readonly role: MemberRole;
  readonly status: MemberStatus;
};

/**
 * Finds the member row of `userId` through `app.member_for_user` (SECURITY DEFINER),
 * the single path around RLS. Call it only with a user id taken from the session.
 */
export async function memberForUser(
  database: Pick<Database, 'pool'>,
  userId: string,
): Promise<MemberForUser | null> {
  const { rows } = await database.pool.query<{
    member_id: string;
    company_id: string;
    role: MemberRole;
    status: MemberStatus;
  }>('select member_id, company_id, role, status from app.member_for_user($1)', [userId]);
  const row = rows[0];
  return row
    ? { memberId: row.member_id, companyId: row.company_id, role: row.role, status: row.status }
    : null;
}

export type AuditEventInput = {
  readonly actorMemberId: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId?: string | null;
  /** Names of changed fields only — never values (spec audit-log). */
  readonly fields?: readonly string[] | null;
};

/** Appends an AuditEvent for the transaction's company (taken from `app.company_id`). */
export async function recordAudit(tx: CompanyTx, event: AuditEventInput): Promise<void> {
  await tx.insert(auditEvents).values({
    companyId: sql`app.current_company_id()`,
    actorMemberId: event.actorMemberId,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId ?? null,
    fields: event.fields ? [...event.fields] : null,
  });
}

export type InvitationLookup = {
  readonly id: string;
  readonly companyId: string;
  readonly companyName: string;
  readonly inviterName: string;
  readonly email: string;
  readonly role: MemberRole;
  readonly departmentId: string | null;
  readonly departmentName: string | null;
  readonly departmentArchived: boolean;
  readonly status: 'pending' | 'accepted' | 'cancelled';
  readonly expiresAt: Date;
};

/**
 * The invitation whose token hashes to `tokenHash`, through
 * `app.invitation_by_token_hash` (SECURITY DEFINER, design D4). One row or null;
 * there is deliberately no way to list invitations without a company.
 */
export async function invitationByTokenHash(
  database: Pick<Database, 'pool'>,
  tokenHash: Buffer,
): Promise<InvitationLookup | null> {
  const { rows } = await database.pool.query<{
    id: string;
    company_id: string;
    company_name: string;
    inviter_name: string;
    email: string;
    role: MemberRole;
    department_id: string | null;
    department_name: string | null;
    department_archived: boolean;
    status: InvitationLookup['status'];
    expires_at: Date;
  }>('select * from app.invitation_by_token_hash($1)', [tokenHash]);
  const row = rows[0];
  return row
    ? {
        id: row.id,
        companyId: row.company_id,
        companyName: row.company_name,
        inviterName: row.inviter_name,
        email: row.email,
        role: row.role,
        departmentId: row.department_id,
        departmentName: row.department_name,
        departmentArchived: row.department_archived,
        status: row.status,
        expiresAt: row.expires_at,
      }
    : null;
}

/** True when `error` (or its Drizzle `cause`) is a unique violation of `constraint`. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const cause = (error as { cause?: unknown } | null)?.cause ?? error;
  const pgError = cause as { code?: string; constraint?: string } | null;
  return (
    pgError?.code === '23505' && (constraint === undefined || pgError.constraint === constraint)
  );
}
