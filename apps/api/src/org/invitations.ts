import { createHash, randomBytes } from 'node:crypto';
import {
  canAssignRole,
  canManageMember,
  type InvitationInput,
  MEMBER_RULE_ERRORS,
  type Role,
} from '@dw/core';
import {
  type CompanyTx,
  departments,
  type InvitationLookup,
  invitations,
  isUniqueViolation,
  memberProfiles,
  members,
  recordAudit,
} from '@dw/db';
import { and, desc, eq, inArray, isNull, lt, sql } from '@dw/db/drizzle';
import { denied, fieldError, notFound, type Outcome, ok, rejected } from './outcome.ts';

export const INVITATION_TTL_DAYS = 7; // 0.2 #034

/** 32 random bytes, base64url; only its SHA-256 is stored (design D4). */
export function newInvitationToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

const expiresAt = sql`now() + interval '${sql.raw(String(INVITATION_TTL_DAYS))} days'`;

export type Actor = { readonly memberId: string; readonly role: Role };

export type InvitationRow = {
  id: string;
  email: string;
  role: Role;
  departmentId: string | null;
  departmentName: string | null;
  state: 'pending' | 'expired';
  expiresAt: Date;
  createdAt: Date;
};

/** Unaccepted, uncancelled invitations; "expired" is derived from expires_at (design D1). */
export async function listInvitations(
  tx: CompanyTx,
  state?: 'pending' | 'expired',
): Promise<InvitationRow[]> {
  const rows = await tx
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      departmentId: invitations.departmentId,
      departmentName: departments.name,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
      expired: sql<boolean>`${invitations.expiresAt} <= now()`,
    })
    .from(invitations)
    .leftJoin(departments, eq(departments.id, invitations.departmentId))
    .where(eq(invitations.status, 'pending'))
    .orderBy(desc(invitations.createdAt));
  return rows
    .map(({ expired, ...row }) => ({
      ...row,
      state: expired ? ('expired' as const) : ('pending' as const),
    }))
    .filter((row) => state === undefined || row.state === state);
}

/** Department exists in this company and is not archived (held FOR SHARE until commit). */
async function departmentName(tx: CompanyTx, id: string): Promise<string | null> {
  const [row] = await tx
    .select({ name: departments.name })
    .from(departments)
    .where(and(eq(departments.id, id), isNull(departments.archivedAt)))
    .for('share');
  return row?.name ?? null;
}

/** 409 when the department already has a Manager or a pending, unexpired Manager invite. */
async function departmentHeadTaken(
  tx: CompanyTx,
  departmentId: string,
  exceptInvitationId?: string,
): Promise<boolean> {
  const [head] = await tx
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.departmentId, departmentId), eq(members.role, 'manager')));
  if (head) return true;
  const pending = await tx
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(
        eq(invitations.departmentId, departmentId),
        eq(invitations.role, 'manager'),
        eq(invitations.status, 'pending'),
        sql`${invitations.expiresAt} > now()`,
      ),
    );
  return pending.some((row) => row.id !== exceptInvitationId);
}

export type CreatedInvitation = { id: string; email: string; token: string };
export type SkippedEmail = { email: string; reason: 'already_member' | 'already_invited' };

/**
 * POST /api/invitations (spec invitations). Emails that are already members or
 * have a pending, unexpired invitation are reported, not invited; the rest are.
 * An expired invitation for the same email is cancelled and replaced.
 */
export async function createInvitations(
  tx: CompanyTx,
  actor: Actor,
  input: InvitationInput,
): Promise<
  Outcome<{
    created: CreatedInvitation[];
    skipped: SkippedEmail[];
    departmentName: string | null;
  }>
> {
  if (!canAssignRole(actor.role, input.role)) return denied(MEMBER_RULE_ERRORS.roleRequiresOwner);
  let deptName: string | null = null;
  if (input.departmentId !== null) {
    deptName = await departmentName(tx, input.departmentId);
    if (deptName === null) return fieldError('departmentId', 'department_not_found');
    if (input.role === 'manager') {
      await cancelExpired(
        tx,
        and(eq(invitations.departmentId, input.departmentId), eq(invitations.role, 'manager')),
      );
      if (await departmentHeadTaken(tx, input.departmentId)) {
        return rejected(409, MEMBER_RULE_ERRORS.departmentHasHead);
      }
    }
  }

  const existingMembers = new Set(
    (
      await tx
        .select({ email: memberProfiles.email })
        .from(memberProfiles)
        .where(inArray(sql`lower(${memberProfiles.email})`, input.emails))
    ).map((row) => row.email.toLowerCase()),
  );
  await cancelExpired(tx, inArray(invitations.email, input.emails));
  const pending = new Set(
    (
      await tx
        .select({ email: invitations.email })
        .from(invitations)
        .where(and(eq(invitations.status, 'pending'), inArray(invitations.email, input.emails)))
    ).map((row) => row.email),
  );

  const created: CreatedInvitation[] = [];
  const skipped: SkippedEmail[] = [];
  for (const email of input.emails) {
    if (existingMembers.has(email)) {
      skipped.push({ email, reason: 'already_member' });
      continue;
    }
    if (pending.has(email)) {
      skipped.push({ email, reason: 'already_invited' });
      continue;
    }
    const { token, hash } = newInvitationToken();
    const [row] = await tx
      .insert(invitations)
      .values({
        companyId: sql`app.current_company_id()`,
        email,
        role: input.role,
        departmentId: input.departmentId,
        invitedByMemberId: actor.memberId,
        tokenHash: hash,
        expiresAt,
      })
      .returning({ id: invitations.id });
    if (!row) throw new Error('invitation insert returned no row');
    // The AuditEvent names the invitation only: never its email or token (spec audit-log).
    await recordAudit(tx, {
      actorMemberId: actor.memberId,
      action: 'invitation.created',
      targetType: 'invitation',
      targetId: row.id,
    });
    created.push({ id: row.id, email, token });
  }
  return ok({ created, skipped, departmentName: deptName });
}

async function cancelExpired(tx: CompanyTx, where: ReturnType<typeof and>) {
  await tx
    .update(invitations)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(invitations.status, 'pending'), lt(invitations.expiresAt, sql`now()`), where));
}

async function lockPending(tx: CompanyTx, id: string) {
  const [row] = await tx
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      departmentId: invitations.departmentId,
      status: invitations.status,
    })
    .from(invitations)
    .where(eq(invitations.id, id))
    .for('update');
  return row ?? null;
}

/** New token and a fresh 7 days; the old link stops working at once (0.2 #034). */
export async function resendInvitation(
  tx: CompanyTx,
  actor: Actor,
  id: string,
): Promise<Outcome<{ email: string; token: string; role: Role; departmentName: string | null }>> {
  const row = await lockPending(tx, id);
  if (!row) return notFound;
  if (row.status !== 'pending') return rejected(409, 'INVITATION_NOT_PENDING');
  if (!canManageMember(actor.role, row.role)) return denied(MEMBER_RULE_ERRORS.roleRequiresOwner);
  let deptName: string | null = null;
  if (row.departmentId !== null) {
    deptName = await departmentName(tx, row.departmentId);
    if (deptName === null) return rejected(409, 'INVITATION_NOT_PENDING');
    if (row.role === 'manager' && (await departmentHeadTaken(tx, row.departmentId, row.id))) {
      return rejected(409, MEMBER_RULE_ERRORS.departmentHasHead);
    }
  }
  const { token, hash } = newInvitationToken();
  await tx
    .update(invitations)
    .set({ tokenHash: hash, expiresAt, updatedAt: new Date() })
    .where(eq(invitations.id, id));
  await recordAudit(tx, {
    actorMemberId: actor.memberId,
    action: 'invitation.resent',
    targetType: 'invitation',
    targetId: id,
  });
  return ok({ email: row.email, token, role: row.role, departmentName: deptName });
}

export async function cancelInvitation(
  tx: CompanyTx,
  actor: Actor,
  id: string,
): Promise<Outcome<{ id: string }>> {
  const row = await lockPending(tx, id);
  if (!row) return notFound;
  if (row.status !== 'pending') return rejected(409, 'INVITATION_NOT_PENDING');
  if (!canManageMember(actor.role, row.role)) return denied(MEMBER_RULE_ERRORS.roleRequiresOwner);
  await tx
    .update(invitations)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(invitations.id, id));
  await recordAudit(tx, {
    actorMemberId: actor.memberId,
    action: 'invitation.cancelled',
    targetType: 'invitation',
    targetId: id,
  });
  return ok({ id });
}

/** Why a looked-up invitation cannot be used, or null when it can. */
export function invitationProblem(
  found: InvitationLookup | null,
  now: Date = new Date(),
): 'INVITATION_INVALID' | 'INVITATION_EXPIRED' | null {
  if (found?.status !== 'pending' || found.departmentArchived) return 'INVITATION_INVALID';
  return found.expiresAt <= now ? 'INVITATION_EXPIRED' : null;
}

/**
 * Turns the invitation into a membership for `userId` (design D4): re-checked
 * under FOR UPDATE inside the company, so it can be used only once.
 */
export async function acceptInvitation(
  tx: CompanyTx,
  invitationId: string,
  userId: string,
): Promise<Outcome<{ memberId: string }>> {
  const [row] = await tx
    .select({
      id: invitations.id,
      companyId: invitations.companyId,
      role: invitations.role,
      departmentId: invitations.departmentId,
      status: invitations.status,
      expired: sql<boolean>`${invitations.expiresAt} <= now()`,
    })
    .from(invitations)
    .where(eq(invitations.id, invitationId))
    .for('update');
  if (row?.status !== 'pending') return rejected(410, 'INVITATION_INVALID');
  if (row.expired) return rejected(410, 'INVITATION_EXPIRED');
  if (row.departmentId !== null && (await departmentName(tx, row.departmentId)) === null) {
    return rejected(410, 'INVITATION_INVALID');
  }
  const [member] = await tx
    .insert(members)
    .values({ companyId: row.companyId, userId, role: row.role, departmentId: row.departmentId })
    .returning({ id: members.id });
  if (!member) throw new Error('member insert returned no row');
  await tx
    .update(invitations)
    .set({ status: 'accepted', acceptedMemberId: member.id, updatedAt: new Date() })
    .where(eq(invitations.id, invitationId));
  await recordAudit(tx, {
    actorMemberId: member.id,
    action: 'invitation.accepted',
    targetType: 'invitation',
    targetId: invitationId,
  });
  return ok({ memberId: member.id });
}

/** Unique violations from invitation writes, as outcomes. */
export function invitationWriteError(error: unknown): Outcome<never> {
  if (isUniqueViolation(error, 'members_user_id_unique'))
    return rejected(409, 'ALREADY_IN_COMPANY');
  if (
    isUniqueViolation(error, 'members_department_manager_uq') ||
    isUniqueViolation(error, 'invitations_department_manager_pending_uq')
  ) {
    return rejected(409, MEMBER_RULE_ERRORS.departmentHasHead);
  }
  if (isUniqueViolation(error, 'invitations_company_email_pending_uq')) {
    return rejected(409, 'ALREADY_INVITED');
  }
  throw error;
}
