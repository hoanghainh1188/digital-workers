import { describe, expect, it } from 'vitest';
import {
  assignableRoles,
  canAssignRole,
  canManageMember,
  lockError,
  removesLastOwner,
  resolveMembership,
  validateMembership,
} from './member-rules.ts';
import type { Role } from './permissions.ts';

const Y = true;
const N = false;

// actor × target → may manage (change role / move / lock / unlock / resend / cancel)
const MANAGE: ReadonlyArray<readonly [Role, Role, boolean]> = [
  ['owner', 'owner', Y],
  ['owner', 'admin', Y],
  ['owner', 'manager', Y],
  ['owner', 'member', Y],
  ['admin', 'owner', N],
  ['admin', 'admin', N],
  ['admin', 'manager', Y],
  ['admin', 'member', Y],
  ['manager', 'owner', N],
  ['manager', 'admin', N],
  ['manager', 'manager', N],
  ['manager', 'member', N],
  ['member', 'owner', N],
  ['member', 'admin', N],
  ['member', 'manager', N],
  ['member', 'member', N],
];

describe('canManageMember / canAssignRole (0.2 #039, #063)', () => {
  it.each(MANAGE)('%s managing %s → %s', (actor, target, expected) => {
    expect(canManageMember(actor, target)).toBe(expected);
  });

  it.each(MANAGE)('%s assigning role %s → %s', (actor, role, expected) => {
    expect(canAssignRole(actor, role)).toBe(expected);
  });

  it('assignableRoles lists what each role may hand out', () => {
    expect(assignableRoles('owner')).toEqual(['owner', 'admin', 'manager', 'member']);
    expect(assignableRoles('admin')).toEqual(['manager', 'member']);
    expect(assignableRoles('manager')).toEqual([]);
    expect(assignableRoles('member')).toEqual([]);
  });
});

describe('validateMembership (0.2 #036)', () => {
  it.each([
    ['owner', null, null],
    ['admin', null, null],
    ['owner', 'd1', null],
    ['manager', 'd1', null],
    ['member', 'd1', null],
    ['manager', null, 'DEPARTMENT_REQUIRED'],
    ['member', null, 'DEPARTMENT_REQUIRED'],
  ] as const)('%s in %s → %s', (role, department, expected) => {
    expect(validateMembership(role, department)).toBe(expected);
  });
});

describe('resolveMembership', () => {
  it.each([
    // [current role, current dept, patch, expected]
    [
      'member',
      'd1',
      { role: 'manager' },
      { ok: true, next: { role: 'manager', departmentId: 'd1' } },
    ],
    [
      'member',
      'd1',
      { departmentId: 'd2' },
      { ok: true, next: { role: 'member', departmentId: 'd2' } },
    ],
    // moving a Manager makes them a Member of the new department (0.2 #062)
    [
      'manager',
      'd1',
      { departmentId: 'd2' },
      { ok: true, next: { role: 'member', departmentId: 'd2' } },
    ],
    // same department: still Manager
    [
      'manager',
      'd1',
      { departmentId: 'd1' },
      { ok: true, next: { role: 'manager', departmentId: 'd1' } },
    ],
    // explicit role wins
    [
      'manager',
      'd1',
      { role: 'manager', departmentId: 'd2' },
      { ok: true, next: { role: 'manager', departmentId: 'd2' } },
    ],
    ['admin', null, { role: 'member' }, { ok: false, error: 'DEPARTMENT_REQUIRED' }],
    [
      'admin',
      null,
      { role: 'member', departmentId: 'd1' },
      { ok: true, next: { role: 'member', departmentId: 'd1' } },
    ],
    ['member', 'd1', { departmentId: null }, { ok: false, error: 'DEPARTMENT_REQUIRED' }],
    [
      'admin',
      'd1',
      { departmentId: null },
      { ok: true, next: { role: 'admin', departmentId: null } },
    ],
    ['member', 'd1', { role: 'admin' }, { ok: true, next: { role: 'admin', departmentId: 'd1' } }],
  ] as const)('%s of %s + %j → %j', (role, departmentId, patch, expected) => {
    expect(resolveMembership({ role, departmentId }, patch)).toEqual(expected);
  });
});

describe('lockError', () => {
  it('refuses to lock oneself', () => {
    expect(lockError('m1', 'm1')).toBe('CANNOT_LOCK_SELF');
    expect(lockError('m1', 'm2')).toBeNull();
  });
});

describe('removesLastOwner (design D3)', () => {
  it.each([
    // target, nextRole, nextActive, activeOwners, expected
    [{ role: 'owner', active: true }, 'admin', true, 1, true],
    [{ role: 'owner', active: true }, 'admin', true, 2, false],
    [{ role: 'owner', active: true }, 'owner', false, 1, true],
    [{ role: 'owner', active: true }, 'owner', false, 2, false],
    [{ role: 'owner', active: true }, 'owner', true, 1, false],
    [{ role: 'owner', active: false }, 'admin', false, 1, false],
    [{ role: 'admin', active: true }, 'member', true, 1, false],
  ] as const)('%j → %s active=%s with %i owners → %s', (target, role, active, owners, expected) => {
    expect(removesLastOwner(target, role, active, owners)).toBe(expected);
  });
});
