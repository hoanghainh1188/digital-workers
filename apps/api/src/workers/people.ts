import type { Role, WorkerActor } from '@dw/core';
import { type CompanyTx, memberProfiles, members } from '@dw/db';
import { and, eq, inArray } from '@dw/db/drizzle';

/** Who is acting, re-read inside the transaction (the request context may be stale). */
export type FreshActor = WorkerActor & { readonly memberId: string };

/**
 * The actor's role and department as they are now, or null when locked. Takes the
 * member row FOR SHARE before any worker row, so locks are always members → workers
 * (the same order as member writes that reassign workers, design D5).
 */
export async function workerActor(
  tx: CompanyTx,
  actor: { readonly memberId: string },
): Promise<FreshActor | null> {
  const [row] = await tx
    .select({ role: members.role, status: members.status, departmentId: members.departmentId })
    .from(members)
    .where(eq(members.id, actor.memberId))
    .for('share');
  return row?.status === 'active'
    ? { memberId: actor.memberId, role: row.role, departmentId: row.departmentId }
    : null;
}

const isOwnerAdmin = (role: Role) => role === 'owner' || role === 'admin';

/**
 * May `memberId` manage or test a worker of `departmentId`? An active member of that
 * department, or an active Owner / Admin (FR-02-01, 0.2 #053, #110).
 */
export async function memberEligibility(
  tx: CompanyTx,
  memberId: string,
  departmentId: string,
): Promise<'ok' | 'ineligible' | 'missing'> {
  const [row] = await tx
    .select({ role: members.role, status: members.status, departmentId: members.departmentId })
    .from(members)
    .where(eq(members.id, memberId));
  if (!row) return 'missing';
  if (row.status !== 'active') return 'ineligible';
  return isOwnerAdmin(row.role) || row.departmentId === departmentId ? 'ok' : 'ineligible';
}

/** The active head (Manager) of a department, if any (0.2 #061). */
export async function departmentHeadId(
  tx: CompanyTx,
  departmentId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.departmentId, departmentId),
        eq(members.role, 'manager'),
        eq(members.status, 'active'),
      ),
    );
  return row?.id ?? null;
}

export type PersonRef = { id: string; name: string };

/** Display names for member ids (missing ids are left out). */
export async function peopleById(
  tx: CompanyTx,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, PersonRef>> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
  if (wanted.length === 0) return new Map();
  const rows = await tx
    .select({ id: memberProfiles.id, name: memberProfiles.name })
    .from(memberProfiles)
    .where(inArray(memberProfiles.id, wanted));
  return new Map(rows.map((row) => [row.id, row]));
}
