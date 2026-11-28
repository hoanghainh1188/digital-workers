import { describe, expect, it } from 'vitest';
import { evaluateIntake, type IntakeSnapshot } from './intake.ts';

const base: IntakeSnapshot = {
  workerStatus: 'active',
  access: 'ok',
  balanceVnd: 50_000,
  monthSpendVnd: 10_000,
  monthlyBudgetVnd: 800_000,
};

describe('evaluateIntake (design D5)', () => {
  it('accepts an active worker with credit and budget left', () => {
    expect(evaluateIntake(base)).toEqual({ kind: 'accept' });
    expect(evaluateIntake({ ...base, workerStatus: 'probation' })).toEqual({ kind: 'accept' });
  });

  it('suspended and offboarded workers answer with a fixed notice', () => {
    expect(evaluateIntake({ ...base, workerStatus: 'suspended' })).toEqual({
      kind: 'notice',
      notice: 'worker_suspended',
    });
    expect(evaluateIntake({ ...base, workerStatus: 'offboarded' })).toEqual({
      kind: 'notice',
      notice: 'worker_offboarded',
    });
  });

  it('draft is refused (403), not answered', () => {
    expect(evaluateIntake({ ...base, workerStatus: 'draft', access: 'draft' })).toEqual({
      kind: 'refuse',
      access: 'draft',
    });
  });

  it('no credit (≤ 0) → credit notice (FR-13-04)', () => {
    expect(evaluateIntake({ ...base, balanceVnd: 0 })).toEqual({
      kind: 'notice',
      notice: 'credit_exhausted',
    });
    expect(evaluateIntake({ ...base, balanceVnd: -200 }).kind).toBe('notice');
  });

  it('spend ≥ budget → budget notice (#018); below → accept', () => {
    expect(evaluateIntake({ ...base, monthSpendVnd: 800_000 })).toEqual({
      kind: 'notice',
      notice: 'budget_exhausted',
    });
    expect(evaluateIntake({ ...base, monthSpendVnd: 799_999 })).toEqual({ kind: 'accept' });
  });

  it('access is checked before state: a stranger never learns the worker is suspended', () => {
    expect(evaluateIntake({ ...base, workerStatus: 'suspended', access: 'forbidden' })).toEqual({
      kind: 'refuse',
      access: 'forbidden',
    });
  });
});
