import { describe, expect, it } from 'vitest';
import {
  activationBudget,
  addDays,
  budgetError,
  newProbation,
  probationDay,
  probationExpired,
  vietnamDate,
} from './rules.ts';

describe('budgetError (0.2 #050, #109)', () => {
  it.each([
    ['manager', 300_000, 2_000_000, null],
    ['manager', 300_000, 2_500_000, 'BUDGET_ABOVE_MANAGER_CAP'],
    ['manager', 3_000_000, 1_000_000, 'BUDGET_ABOVE_MANAGER_CAP'],
    ['manager', 3_000_000, 3_000_000, null],
    ['owner', 300_000, 3_000_000, null],
    ['admin', 3_000_000, 100_000_000, null],
    ['member', 300_000, 2_500_000, null],
  ] as const)('%s %d → %d is %s', (role, current, next, expected) => {
    expect(budgetError(role, current, next)).toBe(expected);
  });
});

describe('activationBudget (0.2 #108)', () => {
  it('raises the probation default and keeps anything else', () => {
    expect(activationBudget(300_000)).toBe(800_000);
    expect(activationBudget(500_000)).toBe(500_000);
    expect(activationBudget(0)).toBe(0);
  });
});

describe('probation dates in Vietnam time (design D9)', () => {
  it('uses the Vietnamese calendar date, also just after midnight there', () => {
    // 17:30 UTC on 22/11 is 00:30 on 23/11 in Vietnam.
    expect(vietnamDate(new Date('2026-11-22T17:30:00Z'))).toBe('2026-11-23');
    expect(vietnamDate(new Date('2026-11-22T16:59:00Z'))).toBe('2026-11-22');
  });

  it('counts day 4 of 14 for a start on 23/11 seen on 26/11', () => {
    const period = newProbation(new Date('2026-11-22T17:30:00Z'));
    expect(period).toEqual({ startedOn: '2026-11-23', endsOn: '2026-12-07' });
    expect(probationDay(period, new Date('2026-11-26T03:00:00Z'))).toEqual({ day: 4, total: 14 });
  });

  it('expires on the first day after the period, and an extension pushes that back', () => {
    const period = { startedOn: '2026-11-23', endsOn: '2026-12-07' };
    expect(probationExpired(period, new Date('2026-12-06T16:59:00Z'))).toBe(false);
    expect(probationExpired(period, new Date('2026-12-06T17:00:00Z'))).toBe(true);
    const extended = { ...period, endsOn: addDays(period.endsOn, 7) };
    expect(extended.endsOn).toBe('2026-12-14');
    expect(probationExpired(extended, new Date('2026-12-07T03:00:00Z'))).toBe(false);
    expect(probationDay(extended, new Date('2026-12-07T03:00:00Z'))).toEqual({
      day: 15,
      total: 21,
    });
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-25', 14)).toBe('2027-01-08');
    expect(addDays('2028-02-20', 14)).toBe('2028-03-05');
  });
});
