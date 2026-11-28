import { describe, expect, it } from 'vitest';
import type { Role } from '../access/permissions.ts';
import type { WorkerStatus } from '../workers/lifecycle.ts';
import { type AssignmentDecision, decideAssignment } from './assignment-rules.ts';

const DEPT = 'dept-sales';
const OTHER = 'dept-accounting';
const skill = (over: Partial<Parameters<typeof decideAssignment>[2]> = {}) => ({
  archived: false,
  approved: true,
  hasScripts: false,
  alreadyAssigned: false,
  ...over,
});
const actor = (role: Role, departmentId: string | null = DEPT) => ({ role, departmentId });
const worker = (status: WorkerStatus, departmentId = DEPT) => ({ status, departmentId });

type Row = readonly [Role, WorkerStatus, boolean, AssignmentDecision];
// role × worker status × has scripts (same department) — design D8 table.
const TABLE: Row[] = [];
for (const role of ['owner', 'admin'] as const) {
  for (const status of ['draft', 'probation'] as const) {
    TABLE.push([role, status, false, 'grant'], [role, status, true, 'request']);
  }
  for (const status of ['active', 'suspended'] as const) {
    TABLE.push(
      [role, status, false, 'grant'],
      [role, status, true, { error: 'SKILL_NEEDS_REVIEW' }],
    );
  }
  TABLE.push([role, 'offboarded', false, { error: 'WORKER_OFFBOARDED' }]);
}
for (const status of ['draft', 'probation'] as const) {
  TABLE.push(['manager', status, false, 'grant'], ['manager', status, true, 'request']);
}
for (const status of ['active', 'suspended'] as const) {
  TABLE.push(
    ['manager', status, false, 'request'],
    ['manager', status, true, { error: 'SKILL_NEEDS_REVIEW' }],
  );
}
TABLE.push(['manager', 'offboarded', true, { error: 'WORKER_OFFBOARDED' }]);
for (const status of ['draft', 'probation', 'active', 'suspended', 'offboarded'] as const) {
  TABLE.push(['member', status, false, { error: 'FORBIDDEN' }]);
}

describe('decideAssignment', () => {
  it.each(TABLE)('%s → %s worker, scripts=%s → %j', (role, status, hasScripts, expected) => {
    expect(decideAssignment(actor(role), worker(status), skill({ hasScripts }))).toEqual(expected);
  });

  it('manager of another department is forbidden; owner / admin are not', () => {
    for (const status of ['draft', 'active'] as const) {
      expect(decideAssignment(actor('manager'), worker(status, OTHER), skill())).toEqual({
        error: 'FORBIDDEN',
      });
      expect(decideAssignment(actor('admin', null), worker(status, OTHER), skill())).toBe('grant');
    }
  });

  it('checks the skill before the worker', () => {
    expect(
      decideAssignment(actor('owner'), worker('offboarded'), skill({ archived: true })),
    ).toEqual({ error: 'SKILL_ARCHIVED' });
    expect(decideAssignment(actor('owner'), worker('active'), skill({ approved: false }))).toEqual({
      error: 'SKILL_NOT_APPROVED',
    });
    expect(
      decideAssignment(actor('owner'), worker('draft'), skill({ alreadyAssigned: true })),
    ).toEqual({ error: 'ALREADY_ASSIGNED' });
  });
});
