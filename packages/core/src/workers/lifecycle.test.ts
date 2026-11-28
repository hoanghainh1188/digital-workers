import { describe, expect, it } from 'vitest';
import { ROLES, type Role } from '../access/permissions.ts';
import {
  availableEvents,
  decideTransition,
  WORKER_EVENTS,
  WORKER_STATUSES,
  type WorkerEvent,
  type WorkerStatus,
} from './lifecycle.ts';

/**
 * Table test for the worker state machine (design D2). The expectation is built from
 * the two hand-written tables below — paths and who may — combined in the fixed check
 * order: permission → offboarded → expected status → path → data.
 */

// Table 1 — valid paths: event → statuses it starts from, and where it leads.
const PATHS: Record<WorkerEvent, { from: readonly WorkerStatus[]; to: WorkerStatus | 'same' }> = {
  startProbation: { from: ['draft'], to: 'probation' },
  activate: { from: ['probation'], to: 'active' },
  suspend: { from: ['active'], to: 'suspended' },
  resume: { from: ['suspended'], to: 'active' },
  offboard: { from: ['draft', 'probation', 'active', 'suspended'], to: 'offboarded' },
  propose: { from: ['probation'], to: 'same' },
  returnProposal: { from: ['probation'], to: 'same' },
  extendProbation: { from: ['probation'], to: 'same' },
  editTesters: { from: ['draft', 'probation', 'active', 'suspended'], to: 'same' },
};

// Table 2 — who may: [Owner/Admin, Manager same department, Manager other department, Member].
type Who = 'ownerAdmin' | 'managerSame' | 'managerOther' | 'member';
const Y = true;
const N = false;
const MAY: Record<WorkerEvent, Record<Who, boolean>> = {
  startProbation: { ownerAdmin: Y, managerSame: Y, managerOther: N, member: N },
  activate: { ownerAdmin: Y, managerSame: N, managerOther: N, member: N },
  propose: { ownerAdmin: N, managerSame: Y, managerOther: N, member: N },
  extendProbation: { ownerAdmin: Y, managerSame: Y, managerOther: N, member: N },
  returnProposal: { ownerAdmin: Y, managerSame: N, managerOther: N, member: N },
  suspend: { ownerAdmin: Y, managerSame: Y, managerOther: N, member: N },
  resume: { ownerAdmin: Y, managerSame: Y, managerOther: N, member: N },
  offboard: { ownerAdmin: Y, managerSame: Y, managerOther: N, member: N },
  editTesters: { ownerAdmin: Y, managerSame: Y, managerOther: N, member: N },
};

function who(role: Role, sameDepartment: boolean): Who {
  if (role === 'owner' || role === 'admin') return 'ownerAdmin';
  if (role === 'manager') return sameDepartment ? 'managerSame' : 'managerOther';
  return 'member';
}

function expected(status: WorkerStatus, event: WorkerEvent, role: Role, same: boolean) {
  if (!MAY[event][who(role, same)]) return { ok: false, error: 'FORBIDDEN' } as const;
  if (status === 'offboarded') return { ok: false, error: 'WORKER_OFFBOARDED' } as const;
  const path = PATHS[event];
  if (!path.from.includes(status)) return { ok: false, error: 'INVALID_TRANSITION' } as const;
  return { ok: true, next: { status: path.to === 'same' ? status : path.to } } as const;
}

const WORKER_DEPT = 'dept-sales';
const OTHER_DEPT = 'dept-accounting';

function worker(status: WorkerStatus, event: WorkerEvent) {
  return {
    status,
    departmentId: WORKER_DEPT,
    name: 'Minh · Báo giá',
    jobDescription: 'Lập báo giá nháp.',
    hasPendingProposal: event === 'returnProposal',
  };
}

// Input that satisfies every data condition, so only the two tables decide.
function goodInput(status: WorkerStatus) {
  return { expectedStatus: status, reason: 'Tạo nhầm', confirmName: 'Minh · Báo giá' };
}

const cases = WORKER_STATUSES.flatMap((status) =>
  WORKER_EVENTS.flatMap((event) =>
    ROLES.flatMap((role) => [true, false].map((same) => [status, event, role, same] as const)),
  ),
);

describe('decideTransition — full table (design D2)', () => {
  it('covers 5 statuses × 9 events × 4 roles × same / other department', () => {
    expect(cases).toHaveLength(5 * 9 * 4 * 2);
  });

  it.each(cases)('%s + %s by %s (same department: %s)', (status, event, role, same) => {
    const actor = { role, departmentId: same ? WORKER_DEPT : OTHER_DEPT };
    expect(decideTransition(actor, worker(status, event), event, goodInput(status))).toEqual(
      expected(status, event, role, same),
    );
  });

  it.each(cases)('availableEvents agrees for %s + %s by %s (%s)', (status, event, role, same) => {
    const actor = { role, departmentId: same ? WORKER_DEPT : OTHER_DEPT };
    const shown = availableEvents(actor, worker(status, event)).includes(event);
    expect(shown).toBe(expected(status, event, role, same).ok);
  });
});

describe('decideTransition — named cases', () => {
  const owner = { role: 'owner' as const, departmentId: null };
  const salesManager = { role: 'manager' as const, departmentId: WORKER_DEPT };
  const accountingManager = { role: 'manager' as const, departmentId: OTHER_DEPT };
  const salesMember = { role: 'member' as const, departmentId: WORKER_DEPT };
  const base = worker('draft', 'startProbation');

  it('draft straight to active is an invalid transition', () => {
    expect(decideTransition(owner, base, 'activate', { expectedStatus: 'draft' })).toEqual({
      ok: false,
      error: 'INVALID_TRANSITION',
    });
  });

  it('a manager of another department is forbidden whatever the state', () => {
    for (const status of WORKER_STATUSES) {
      expect(
        decideTransition(accountingManager, { ...base, status }, 'offboard', goodInput(status)),
      ).toEqual({ ok: false, error: 'FORBIDDEN' });
    }
  });

  it('a member is forbidden even when they manage the worker', () => {
    const active = { ...base, status: 'active' as const };
    expect(decideTransition(salesMember, active, 'suspend', goodInput('active'))).toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  it('every event on an offboarded worker is refused as offboarded', () => {
    const gone = { ...base, status: 'offboarded' as const };
    for (const event of WORKER_EVENTS) {
      if (event === 'propose') continue; // owner may not propose at all → FORBIDDEN first
      expect(decideTransition(owner, gone, event, goodInput('offboarded'))).toEqual({
        ok: false,
        error: 'WORKER_OFFBOARDED',
      });
    }
  });

  it('a stale expected status is refused before the path check', () => {
    const active = { ...base, status: 'active' as const };
    expect(decideTransition(owner, active, 'suspend', { expectedStatus: 'probation' })).toEqual({
      ok: false,
      error: 'STATUS_CHANGED',
    });
    expect(decideTransition(owner, active, 'startProbation', { expectedStatus: 'draft' })).toEqual({
      ok: false,
      error: 'STATUS_CHANGED',
    });
  });

  it('probation needs a job description', () => {
    expect(
      decideTransition(owner, { ...base, jobDescription: '  ' }, 'startProbation', {
        expectedStatus: 'draft',
      }),
    ).toEqual({ ok: false, error: 'JOB_DESCRIPTION_REQUIRED' });
  });

  it('offboarding needs a reason and the typed name', () => {
    expect(
      decideTransition(salesManager, base, 'offboard', {
        expectedStatus: 'draft',
        confirmName: 'Minh · Báo giá',
      }),
    ).toEqual({ ok: false, error: 'REASON_REQUIRED' });
    expect(
      decideTransition(salesManager, base, 'offboard', {
        expectedStatus: 'draft',
        reason: 'Tạo nhầm',
        confirmName: 'Minh',
      }),
    ).toEqual({ ok: false, error: 'CONFIRM_NAME_MISMATCH' });
    expect(
      decideTransition(salesManager, base, 'offboard', {
        expectedStatus: 'draft',
        reason: 'Tạo nhầm',
        confirmName: '  minh · báo giá ',
      }),
    ).toEqual({ ok: true, next: { status: 'offboarded' } });
  });

  it('proposal rules: one pending at a time, returning needs a pending one and a reason', () => {
    const probation = { ...base, status: 'probation' as const };
    expect(
      decideTransition(salesManager, { ...probation, hasPendingProposal: true }, 'propose', {}),
    ).toEqual({ ok: false, error: 'PROPOSAL_PENDING' });
    expect(decideTransition(owner, probation, 'returnProposal', { reason: 'Sai giá' })).toEqual({
      ok: false,
      error: 'NO_PENDING_PROPOSAL',
    });
    expect(
      decideTransition(owner, { ...probation, hasPendingProposal: true }, 'returnProposal', {}),
    ).toEqual({ ok: false, error: 'REASON_REQUIRED' });
  });

  it('owner activates with or without a proposal', () => {
    const probation = { ...base, status: 'probation' as const };
    for (const hasPendingProposal of [true, false]) {
      expect(
        decideTransition(owner, { ...probation, hasPendingProposal }, 'activate', {
          expectedStatus: 'probation',
        }),
      ).toEqual({ ok: true, next: { status: 'active' } });
    }
  });

  it('availableEvents hides propose while one is pending and return when none is', () => {
    const probation = { ...base, status: 'probation' as const };
    expect(availableEvents(salesManager, probation)).toEqual([
      'propose',
      'extendProbation',
      'offboard',
      'editTesters',
    ]);
    expect(availableEvents(salesManager, { ...probation, hasPendingProposal: true })).toEqual([
      'extendProbation',
      'offboard',
      'editTesters',
    ]);
    expect(availableEvents(owner, { ...probation, hasPendingProposal: true })).toEqual([
      'activate',
      'extendProbation',
      'returnProposal',
      'offboard',
      'editTesters',
    ]);
    expect(availableEvents(salesMember, probation)).toEqual([]);
  });
});
