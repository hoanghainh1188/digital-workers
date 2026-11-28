/**
 * Permission matrix (docs/requirements.md §1) — the single source for api and web
 * (spec access-control). Change the document first, then the test, then this file.
 */

export const ROLES = ['owner', 'admin', 'manager', 'member'] as const;
export type Role = (typeof ROLES)[number];

/**
 * How far a permission reaches:
 * - 'all': the whole company
 * - 'own-department': only the member's own department (Manager rows marked "phòng mình")
 * - 'assigned': only workers the member is assigned to ("nếu được gán")
 * - false: not allowed
 */
export type Scope = 'all' | 'own-department' | 'assigned' | false;

type Row = Readonly<Record<Role, Scope>>;

const ownerAdmin: Row = { owner: 'all', admin: 'all', manager: false, member: false };
const ownDept: Row = { owner: 'all', admin: 'all', manager: 'own-department', member: false };

// "Duyệt việc của worker" is not a role permission: each worker's approval rules decide it.
export const PERMISSIONS = {
  'company.update': ownerAdmin,
  'org.manage': ownerAdmin,
  'member.list': ownDept,
  'worker.view': {
    owner: 'all',
    admin: 'all',
    manager: 'own-department',
    member: 'own-department',
  },
  'worker.edit': ownDept,
  'worker.create': ownDept,
  'worker.startProbation': ownDept,
  'worker.propose': { owner: false, admin: false, manager: 'own-department', member: false },
  'worker.approve': ownerAdmin,
  'worker.suspend': ownDept,
  'skill.edit': { owner: 'all', admin: 'all', manager: 'all', member: 'all' },
  'skill.approve': ownerAdmin,
  'skill.assign': ownDept,
  'task.assign': { owner: 'all', admin: 'all', manager: 'own-department', member: 'assigned' },
  'channel.connect': ownerAdmin,
  'credit.topup': { owner: 'all', admin: false, manager: false, member: false },
  'credit.view': ownerAdmin,
  'payroll.view': ownDept,
} as const satisfies Record<string, Row>;

export type Action = keyof typeof PERMISSIONS;
export const ACTIONS = Object.keys(PERMISSIONS) as readonly Action[];

/** The scope `role` has for `action`; false when not allowed. */
export function can(role: Role, action: Action): Scope {
  return PERMISSIONS[action][role];
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
