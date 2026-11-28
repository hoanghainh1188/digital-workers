import type { Role } from './permissions.ts';

/**
 * Role / department rules for people in a company (design D2, 0.2 #036, #039, #061–#063).
 * Pure functions shared by api (which always re-checks) and web (which hides choices).
 */

/** Error codes. Permission errors map to 403; data invariants to 400 / 409. */
export const MEMBER_RULE_ERRORS = {
  roleRequiresOwner: 'ROLE_REQUIRES_OWNER',
  departmentRequired: 'DEPARTMENT_REQUIRED',
  lastOwner: 'LAST_OWNER',
  cannotLockSelf: 'CANNOT_LOCK_SELF',
  departmentHasHead: 'DEPARTMENT_HAS_HEAD',
} as const;
export type MemberRuleError = (typeof MEMBER_RULE_ERRORS)[keyof typeof MEMBER_RULE_ERRORS];

const OWNER_ONLY_ROLES: ReadonlySet<Role> = new Set(['owner', 'admin']);

/** Owner and Admin are managed (and assigned) only by an Owner (0.2 #039, #063). */
export function isOwnerOnlyRole(role: Role): boolean {
  return OWNER_ONLY_ROLES.has(role);
}

function managesPeople(role: Role): boolean {
  return role === 'owner' || role === 'admin';
}

/**
 * May `actorRole` change role, department or lock state of someone with `targetRole`
 * (also: resend / cancel an invitation for `targetRole`)?
 */
export function canManageMember(actorRole: Role, targetRole: Role): boolean {
  if (!managesPeople(actorRole)) return false;
  return !isOwnerOnlyRole(targetRole) || actorRole === 'owner';
}

/** May `actorRole` give someone `newRole` (when inviting or changing a role)? */
export function canAssignRole(actorRole: Role, newRole: Role): boolean {
  return canManageMember(actorRole, newRole);
}

/** Roles `actorRole` may hand out, in display order. */
export function assignableRoles(actorRole: Role): readonly Role[] {
  return (['owner', 'admin', 'manager', 'member'] as const).filter((role) =>
    canAssignRole(actorRole, role),
  );
}

/** Manager and Member must belong to a department; Owner / Admin may not have one (0.2 #036). */
export function validateMembership(
  role: Role,
  departmentId: string | null,
): MemberRuleError | null {
  return isOwnerOnlyRole(role) || departmentId !== null
    ? null
    : MEMBER_RULE_ERRORS.departmentRequired;
}

export type Membership = { readonly role: Role; readonly departmentId: string | null };
export type MembershipPatch = { readonly role?: Role; readonly departmentId?: string | null };

/**
 * The role and department a member ends up with after `patch`.
 * Moving a Manager to another department without naming a role makes them a
 * Member of the new department (0.2 #062).
 */
export function resolveMembership(
  current: Membership,
  patch: MembershipPatch,
): { ok: true; next: Membership } | { ok: false; error: MemberRuleError } {
  const departmentId = patch.departmentId !== undefined ? patch.departmentId : current.departmentId;
  const movesManager =
    patch.role === undefined && current.role === 'manager' && departmentId !== current.departmentId;
  const role = patch.role ?? (movesManager ? 'member' : current.role);
  const error = validateMembership(role, departmentId);
  return error ? { ok: false, error } : { ok: true, next: { role, departmentId } };
}

/** Locking is refused for oneself; who may lock whom is `canManageMember`. */
export function lockError(actorMemberId: string, targetMemberId: string): MemberRuleError | null {
  return actorMemberId === targetMemberId ? MEMBER_RULE_ERRORS.cannotLockSelf : null;
}

/**
 * Would this change leave the company without an active Owner? `activeOwners`
 * is the current count, read under `FOR UPDATE` by the caller (design D3).
 */
export function removesLastOwner(
  target: { readonly role: Role; readonly active: boolean },
  nextRole: Role,
  nextActive: boolean,
  activeOwners: number,
): boolean {
  const wasActiveOwner = target.role === 'owner' && target.active;
  const staysActiveOwner = nextRole === 'owner' && nextActive;
  return wasActiveOwner && !staysActiveOwner && activeOwners <= 1;
}
