import { can, type DepartmentInput, type DepartmentPatchInput, type Role } from '@dw/core';
import {
  type CompanyTx,
  departments,
  invitations,
  isUniqueViolation,
  memberProfiles,
  members,
  recordAudit,
} from '@dw/db';
import { and, asc, count, eq, isNull, lt, ne, sql } from '@dw/db/drizzle';
import { currentActor, departmentHeadTaken, lockActiveOwners } from './members.ts';
import { denied, fieldError, notFound, type Outcome, ok, rejected } from './outcome.ts';

/** Members shown as avatars on a department card. */
const AVATARS_PER_DEPARTMENT = 4;

export type DepartmentView = {
  id: string;
  name: string;
  description: string | null;
  head: { id: string; name: string } | null;
  memberCount: number;
  members: { id: string; name: string }[];
};

export type Actor = { readonly memberId: string; readonly role: Role };

/**
 * First steps of every department write: the same Owner-row lock that member writes
 * take first (one lock order everywhere, no deadlock with PATCH /api/members), then
 * the actor's role as it is now (the request context may be stale).
 */
async function beginWrite(tx: CompanyTx, actor: Actor): Promise<Outcome<null>> {
  await lockActiveOwners(tx);
  const fresh = await currentActor(tx, actor);
  return fresh && can(fresh.role, 'org.manage') !== false ? ok(null) : denied('FORBIDDEN');
}

/**
 * Non-archived departments with head, member count and a few names (design D5).
 * `withUnassigned`: also count active people without a department (Owner / Admin only).
 */
export async function listDepartments(
  tx: CompanyTx,
  withUnassigned: boolean,
): Promise<{ departments: DepartmentView[]; unassignedCount: number | null }> {
  const rows = await tx
    .select({ id: departments.id, name: departments.name, description: departments.description })
    .from(departments)
    .where(isNull(departments.archivedAt))
    .orderBy(asc(departments.createdAt), asc(departments.name));
  const people = await tx
    .select({
      id: memberProfiles.id,
      name: memberProfiles.name,
      role: memberProfiles.role,
      departmentId: memberProfiles.departmentId,
    })
    .from(memberProfiles)
    .orderBy(asc(memberProfiles.role), asc(memberProfiles.name));

  const views = rows.map((department) => {
    const inside = people.filter((person) => person.departmentId === department.id);
    const head = inside.find((person) => person.role === 'manager');
    return {
      ...department,
      head: head ? { id: head.id, name: head.name } : null,
      memberCount: inside.length,
      members: inside
        .slice(0, AVATARS_PER_DEPARTMENT)
        .map((person) => ({ id: person.id, name: person.name })),
    };
  });

  let unassignedCount: number | null = null;
  if (withUnassigned) {
    const [row] = await tx
      .select({ n: count() })
      .from(members)
      .where(and(isNull(members.departmentId), eq(members.status, 'active')));
    unassignedCount = row?.n ?? 0;
  }
  return { departments: views, unassignedCount };
}

/** The department row if it exists in this company and is not archived, locked FOR UPDATE. */
async function lockDepartment(tx: CompanyTx, id: string) {
  const [row] = await tx
    .select({ id: departments.id, name: departments.name, description: departments.description })
    .from(departments)
    .where(and(eq(departments.id, id), isNull(departments.archivedAt)))
    .for('update');
  return row ?? null;
}

const NAME_TAKEN = 'departments_company_name_active_uq';

export async function createDepartment(
  tx: CompanyTx,
  actor: Actor,
  input: DepartmentInput,
): Promise<Outcome<{ id: string }>> {
  const begun = await beginWrite(tx, actor);
  if (!begun.ok) return begun;
  const [created] = await tx
    .insert(departments)
    .values({
      companyId: sql`app.current_company_id()`,
      name: input.name,
      description: input.description,
    })
    .onConflictDoNothing()
    .returning({ id: departments.id });
  if (!created) return fieldError('name', 'department_name_taken');
  await recordAudit(tx, {
    actorMemberId: actor.memberId,
    action: 'department.created',
    targetType: 'department',
    targetId: created.id,
  });
  if (input.headMemberId) {
    const head = await setDepartmentHead(tx, actor, created.id, input.headMemberId);
    if (!head.ok) return head;
  }
  return ok(created);
}

export async function updateDepartment(
  tx: CompanyTx,
  actor: Actor,
  id: string,
  patch: DepartmentPatchInput,
): Promise<Outcome<{ id: string; changed: string[] }>> {
  const begun = await beginWrite(tx, actor);
  if (!begun.ok) return begun;
  const current = await lockDepartment(tx, id);
  if (!current) return notFound;
  const changed: string[] = [];
  const set: { name?: string; description?: string | null } = {};
  if (patch.name !== undefined && patch.name !== current.name) {
    if (await nameTaken(tx, patch.name, id)) return fieldError('name', 'department_name_taken');
    set.name = patch.name;
    changed.push('name');
  }
  if (patch.description !== undefined && patch.description !== current.description) {
    set.description = patch.description;
    changed.push('description');
  }
  if (Object.keys(set).length > 0) {
    await tx
      .update(departments)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(departments.id, id));
  }
  if (patch.headMemberId !== undefined) {
    const head = await setDepartmentHead(tx, actor, id, patch.headMemberId);
    if (!head.ok) return head;
    if (head.value.changed) changed.push('head');
  }
  if (changed.length > 0) {
    await recordAudit(tx, {
      actorMemberId: actor.memberId,
      action: 'department.updated',
      targetType: 'department',
      targetId: id,
      fields: changed,
    });
  }
  return ok({ id, changed });
}

async function nameTaken(tx: CompanyTx, name: string, exceptId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(
      and(
        sql`lower(${departments.name}) = lower(${name})`,
        isNull(departments.archivedAt),
        ne(departments.id, exceptId),
      ),
    );
  return Boolean(row);
}

/**
 * Makes `headMemberId` the Manager of the department, or removes the head (null).
 * The old head becomes a Member of the same department (0.2 #061); a Member chosen
 * as head becomes Manager and moves in (0.2 #036). Old head first, so the
 * one-Manager-per-department index never sees two (design D5).
 */
export async function setDepartmentHead(
  tx: CompanyTx,
  actor: Actor,
  departmentId: string,
  headMemberId: string | null,
): Promise<Outcome<{ changed: boolean }>> {
  const [current] = await tx
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.departmentId, departmentId), eq(members.role, 'manager')))
    .for('update');
  if (current && current.id === headMemberId) return ok({ changed: false });

  let candidate: { id: string; role: string; status: string; departmentId: string | null } | null =
    null;
  if (headMemberId !== null) {
    const [row] = await tx
      .select({
        id: members.id,
        role: members.role,
        status: members.status,
        departmentId: members.departmentId,
      })
      .from(members)
      .where(eq(members.id, headMemberId))
      .for('update');
    if (!row) return fieldError('headMemberId', 'member_not_found');
    // Only active Managers / Members can lead a department (spec departments).
    if (row.status !== 'active' || (row.role !== 'manager' && row.role !== 'member')) {
      return fieldError('headMemberId', 'head_not_eligible');
    }
    // A pending Manager invitation would collide with this head on accept.
    if (await departmentHeadTaken(tx, departmentId, { exceptMemberId: current?.id ?? row.id })) {
      return rejected(409, 'DEPARTMENT_HAS_HEAD');
    }
    candidate = row;
  }
  if (!current && !candidate) return ok({ changed: false });

  if (current) {
    await tx.update(members).set({ role: 'member' }).where(eq(members.id, current.id));
    await audit(tx, actor, 'member.role_changed', current.id, ['role']);
  }
  if (candidate) {
    await tx
      .update(members)
      .set({ role: 'manager', departmentId })
      .where(eq(members.id, candidate.id));
    if (candidate.role !== 'manager') {
      await audit(tx, actor, 'member.role_changed', candidate.id, ['role']);
    }
    if (candidate.departmentId !== departmentId) {
      await audit(tx, actor, 'member.moved', candidate.id, ['department']);
    }
  }
  return ok({ changed: true });
}

function audit(tx: CompanyTx, actor: Actor, action: string, memberId: string, fields: string[]) {
  return recordAudit(tx, {
    actorMemberId: actor.memberId,
    action,
    targetType: 'member',
    targetId: memberId,
    fields,
  });
}

/**
 * Archives an empty department (0.2 #037, #064): no member in any state and no
 * pending, unexpired invitation. Expired invitations into it are cancelled.
 */
export async function archiveDepartment(
  tx: CompanyTx,
  actor: Actor,
  id: string,
): Promise<Outcome<{ id: string }>> {
  const begun = await beginWrite(tx, actor);
  if (!begun.ok) return begun;
  const current = await lockDepartment(tx, id);
  if (!current) return notFound;
  const [people] = await tx
    .select({ n: count() })
    .from(members)
    .where(eq(members.departmentId, id));
  const [waiting] = await tx
    .select({ n: count() })
    .from(invitations)
    .where(
      and(
        eq(invitations.departmentId, id),
        eq(invitations.status, 'pending'),
        sql`${invitations.expiresAt} > now()`,
      ),
    );
  const memberCount = people?.n ?? 0;
  const invitationCount = waiting?.n ?? 0;
  if (memberCount > 0 || invitationCount > 0) {
    return rejected(409, 'DEPARTMENT_NOT_EMPTY', {
      members: memberCount,
      invitations: invitationCount,
    });
  }
  await tx
    .update(invitations)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(
      and(
        eq(invitations.departmentId, id),
        eq(invitations.status, 'pending'),
        lt(invitations.expiresAt, sql`now()`),
      ),
    );
  await tx
    .update(departments)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(departments.id, id));
  await recordAudit(tx, {
    actorMemberId: actor.memberId,
    action: 'department.archived',
    targetType: 'department',
    targetId: id,
  });
  return ok({ id });
}

/** Maps a unique-violation thrown by a department write to its outcome, or rethrows. */
export function departmentWriteError(error: unknown): Outcome<never> {
  if (isUniqueViolation(error, NAME_TAKEN)) return fieldError('name', 'department_name_taken');
  if (isUniqueViolation(error, 'members_department_manager_uq')) {
    return rejected(409, 'DEPARTMENT_HAS_HEAD');
  }
  throw error;
}
