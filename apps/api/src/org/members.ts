import {
  canAssignRole,
  canManageMember,
  lockError,
  MEMBER_RULE_ERRORS,
  type MemberPatchInput,
  type Role,
  removesLastOwner,
  resolveMembership,
} from '@dw/core';
import {
  type CompanyTx,
  type Database,
  departments,
  invitations,
  isUniqueViolation,
  memberProfiles,
  members,
  recordAudit,
  withCompany,
} from '@dw/db';
import { and, asc, eq, ilike, isNull, or, sql } from '@dw/db/drizzle';
import { denied, fieldError, notFound, type Outcome, ok, rejected } from './outcome.ts';

export type MemberActor = { readonly memberId: string; readonly role: Role };

export type MemberFilters = {
  readonly q?: string;
  readonly role?: Role;
  /** A department id, or 'none' for people without one. */
  readonly department?: string;
  readonly status?: 'active' | 'locked';
};

export type MemberRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'locked';
  departmentId: string | null;
  departmentName: string | null;
  lockedAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
};

/** Escapes LIKE wildcards in user input. */
function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * GET /api/members (design D6). A Manager only ever sees their own department:
 * the department filter is forced server-side, whatever the query says (0.2 #038).
 */
export async function listMembers(
  tx: CompanyTx,
  actor: MemberActor,
  filters: MemberFilters,
): Promise<MemberRow[]> {
  let department = filters.department;
  if (actor.role === 'manager') {
    const [self] = await tx
      .select({ departmentId: members.departmentId })
      .from(members)
      .where(eq(members.id, actor.memberId));
    department = self?.departmentId ?? 'none';
    if (department === 'none') return [];
  }
  const conditions = [
    filters.q
      ? or(
          ilike(memberProfiles.name, likePattern(filters.q)),
          ilike(memberProfiles.email, likePattern(filters.q)),
        )
      : undefined,
    filters.role ? eq(memberProfiles.role, filters.role) : undefined,
    department === 'none'
      ? isNull(memberProfiles.departmentId)
      : department
        ? eq(memberProfiles.departmentId, department)
        : undefined,
    filters.status ? eq(memberProfiles.status, filters.status) : undefined,
  ].filter((condition) => condition !== undefined);

  return tx
    .select({
      id: memberProfiles.id,
      name: memberProfiles.name,
      email: memberProfiles.email,
      role: memberProfiles.role,
      status: memberProfiles.status,
      departmentId: memberProfiles.departmentId,
      departmentName: departments.name,
      lockedAt: memberProfiles.lockedAt,
      lastSeenAt: memberProfiles.lastSeenAt,
      createdAt: memberProfiles.createdAt,
    })
    .from(memberProfiles)
    .leftJoin(departments, eq(departments.id, memberProfiles.departmentId))
    .where(and(...conditions))
    .orderBy(asc(memberProfiles.role), asc(memberProfiles.name));
}

/**
 * Locks the active Owners in id order before any change that could lower their
 * number, so two concurrent requests queue instead of both passing (design D3).
 * Always taken first, before the target row, so lock order is the same everywhere.
 */
export async function lockActiveOwners(tx: CompanyTx): Promise<number> {
  const rows = await tx
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.role, 'owner'), eq(members.status, 'active')))
    .orderBy(asc(members.id))
    .for('update');
  return rows.length;
}

/**
 * The actor's role as it is now, read inside the transaction: the request context
 * was resolved before this transaction and may be stale (e.g. demoted meanwhile).
 */
export async function currentActor(tx: CompanyTx, actor: MemberActor): Promise<MemberActor | null> {
  const [row] = await tx
    .select({ role: members.role, status: members.status })
    .from(members)
    .where(eq(members.id, actor.memberId))
    .for('share');
  return row?.status === 'active' ? { memberId: actor.memberId, role: row.role } : null;
}

async function lockTarget(tx: CompanyTx, id: string) {
  const [row] = await tx
    .select({
      id: members.id,
      userId: members.userId,
      role: members.role,
      status: members.status,
      departmentId: members.departmentId,
    })
    .from(members)
    .where(eq(members.id, id))
    .for('update');
  return row ?? null;
}

/** True when the department exists in this company and is not archived (held FOR SHARE). */
async function activeDepartment(tx: CompanyTx, id: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, id), isNull(departments.archivedAt)))
    .for('share');
  return Boolean(row);
}

/**
 * True when the department already has a Manager (other than `exceptMemberId`) or a
 * pending, unexpired Manager invitation (other than `exceptInvitationId`), so a
 * second head can come neither from a role change nor from accepting an invite.
 */
export async function departmentHeadTaken(
  tx: CompanyTx,
  departmentId: string,
  except: { exceptMemberId?: string; exceptInvitationId?: string } = {},
): Promise<boolean> {
  const heads = await tx
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.departmentId, departmentId), eq(members.role, 'manager')));
  if (heads.some((row) => row.id !== except.exceptMemberId)) return true;
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
  return pending.some((row) => row.id !== except.exceptInvitationId);
}

/** PATCH /api/members/:id: change role and / or department (spec member-management). */
export async function patchMember(
  tx: CompanyTx,
  actor: MemberActor,
  id: string,
  patch: MemberPatchInput,
): Promise<Outcome<{ id: string; changed: string[] }>> {
  const activeOwners = await lockActiveOwners(tx);
  const target = await lockTarget(tx, id);
  if (!target) return notFound;
  const fresh = await currentActor(tx, actor);
  if (!fresh) return denied(MEMBER_RULE_ERRORS.roleRequiresOwner);
  actor = fresh;
  if (!canManageMember(actor.role, target.role))
    return denied(MEMBER_RULE_ERRORS.roleRequiresOwner);
  if (patch.role !== undefined && !canAssignRole(actor.role, patch.role)) {
    return denied(MEMBER_RULE_ERRORS.roleRequiresOwner);
  }

  const resolved = resolveMembership(target, patch);
  if (!resolved.ok) return fieldError('departmentId', 'department_required');
  const { role, departmentId } = resolved.next;
  const roleChanged = role !== target.role;
  const moved = departmentId !== target.departmentId;
  if (!roleChanged && !moved) return ok({ id, changed: [] });

  if (moved && departmentId !== null && !(await activeDepartment(tx, departmentId))) {
    return fieldError('departmentId', 'department_not_found');
  }
  if (
    removesLastOwner(
      { role: target.role, active: target.status === 'active' },
      role,
      true,
      activeOwners,
    )
  ) {
    return rejected(409, MEMBER_RULE_ERRORS.lastOwner);
  }
  if (role === 'manager' && departmentId !== null) {
    if (await departmentHeadTaken(tx, departmentId, { exceptMemberId: id })) {
      return rejected(409, MEMBER_RULE_ERRORS.departmentHasHead);
    }
  }

  await tx.update(members).set({ role, departmentId }).where(eq(members.id, id));
  const changed: string[] = [];
  if (roleChanged) {
    changed.push('role');
    await audit(tx, actor, 'member.role_changed', id, ['role']);
  }
  if (moved) {
    changed.push('department');
    await audit(tx, actor, 'member.moved', id, ['department']);
  }
  return ok({ id, changed });
}

/** Locks a member (0.2 #040). The caller revokes their sessions after commit. */
export async function lockMember(
  tx: CompanyTx,
  actor: MemberActor,
  id: string,
): Promise<Outcome<{ userId: string; changed: boolean }>> {
  const activeOwners = await lockActiveOwners(tx);
  const target = await lockTarget(tx, id);
  if (!target) return notFound;
  const fresh = await currentActor(tx, actor);
  if (!fresh) return denied(MEMBER_RULE_ERRORS.roleRequiresOwner);
  actor = fresh;
  const selfError = lockError(actor.memberId, id);
  if (selfError) return rejected(409, selfError);
  if (!canManageMember(actor.role, target.role))
    return denied(MEMBER_RULE_ERRORS.roleRequiresOwner);
  if (target.status === 'locked') return ok({ userId: target.userId, changed: false });
  if (removesLastOwner({ role: target.role, active: true }, target.role, false, activeOwners)) {
    return rejected(409, MEMBER_RULE_ERRORS.lastOwner);
  }
  await tx
    .update(members)
    .set({ status: 'locked', lockedAt: sql`now()` })
    .where(eq(members.id, id));
  await audit(tx, actor, 'member.locked', id);
  return ok({ userId: target.userId, changed: true });
}

export async function unlockMember(
  tx: CompanyTx,
  actor: MemberActor,
  id: string,
): Promise<Outcome<{ changed: boolean }>> {
  // Same first lock as patch / lock, so every member write takes locks in one order.
  await lockActiveOwners(tx);
  const target = await lockTarget(tx, id);
  if (!target) return notFound;
  const fresh = await currentActor(tx, actor);
  if (!fresh) return denied(MEMBER_RULE_ERRORS.roleRequiresOwner);
  actor = fresh;
  if (!canManageMember(actor.role, target.role))
    return denied(MEMBER_RULE_ERRORS.roleRequiresOwner);
  if (target.status === 'active') return ok({ changed: false });
  await tx.update(members).set({ status: 'active', lockedAt: null }).where(eq(members.id, id));
  await audit(tx, actor, 'member.unlocked', id);
  return ok({ changed: true });
}

function audit(
  tx: CompanyTx,
  actor: MemberActor,
  action: string,
  memberId: string,
  fields?: string[],
) {
  return recordAudit(tx, {
    actorMemberId: actor.memberId,
    action,
    targetType: 'member',
    targetId: memberId,
    fields: fields ?? null,
  });
}

/** Maps a unique violation from a member write (concurrent head change) to 409. */
export function memberWriteError(error: unknown): Outcome<never> {
  if (isUniqueViolation(error, 'members_department_manager_uq')) {
    return rejected(409, MEMBER_RULE_ERRORS.departmentHasHead);
  }
  throw error;
}

const HOUR = 60 * 60 * 1000;

/**
 * Updates `members.last_seen_at` at most once an hour per member (design D6).
 * An in-memory note avoids a database write on every request.
 */
export function createLastSeenTracker(
  database: Pick<Database, 'db'>,
  now: () => number = Date.now,
) {
  const touched = new Map<string, number>();
  return async (member: { companyId: string; memberId: string }): Promise<void> => {
    const time = now();
    const last = touched.get(member.memberId);
    if (last !== undefined && time - last < HOUR) return;
    if (touched.size > 50_000) touched.clear();
    await withCompany(database, member.companyId, (tx) =>
      tx
        .update(members)
        .set({ lastSeenAt: sql`now()` })
        .where(
          and(
            eq(members.id, member.memberId),
            or(isNull(members.lastSeenAt), sql`${members.lastSeenAt} < now() - interval '1 hour'`),
          ),
        ),
    );
    // Noted only after the write, so a failed update is retried on the next request.
    touched.set(member.memberId, time);
  };
}
