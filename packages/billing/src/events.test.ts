import { describe, expect, it } from 'vitest';
import { afterCredit, afterDebit, creditState, lowThreshold } from './events.ts';

const fresh = { lowNotified: false, zeroNotified: false };

describe('low / exhausted decisions (spec credit-ledger)', () => {
  it('threshold is 20% of the latest credit, rounded down', () => {
    expect(lowThreshold(1_000_000)).toBe(200_000);
    expect(lowThreshold(999)).toBe(199);
    expect(lowThreshold(0)).toBe(0);
  });

  it('crossing below the threshold sends one "low" event', () => {
    const result = afterDebit(201_000, 199_000, 1_000_000, fresh);
    expect(result.events).toEqual([{ type: 'low', balanceVnd: 199_000, thresholdVnd: 200_000 }]);
    expect(result.flags).toEqual({ lowNotified: true, zeroNotified: false });
  });

  it('further debits under the threshold send nothing', () => {
    const again = afterDebit(199_000, 150_000, 1_000_000, {
      lowNotified: true,
      zeroNotified: false,
    });
    expect(again.events).toEqual([]);
  });

  it('a credit resets the low flag once the balance is back above the new threshold', () => {
    const flags = afterCredit(650_000, 500_000, { lowNotified: true, zeroNotified: false });
    expect(flags.lowNotified).toBe(false);
    expect(afterDebit(101_000, 99_000, 500_000, flags).events).toEqual([
      { type: 'low', balanceVnd: 99_000, thresholdVnd: 100_000 },
    ]);
  });

  it('a credit that leaves the balance under the new threshold keeps the flag', () => {
    expect(afterCredit(10, 1000, { lowNotified: true, zeroNotified: true }).lowNotified).toBe(true);
  });

  it('exhausted fires only when going from > 0 to ≤ 0', () => {
    expect(afterDebit(300, -50, 1_000_000, fresh).events).toEqual([{ type: 'exhausted' }]);
    expect(afterDebit(0, -10, 1_000_000, fresh).events).toEqual([]);
    expect(
      afterDebit(300, -50, 1_000_000, { lowNotified: true, zeroNotified: true }).events,
    ).toEqual([]);
  });

  it('a credit that brings the balance above 0 clears the exhausted flag', () => {
    expect(
      afterCredit(99_850, 100_000, { lowNotified: true, zeroNotified: true }).zeroNotified,
    ).toBe(false);
    expect(afterCredit(-50, 100, { lowNotified: true, zeroNotified: true }).zeroNotified).toBe(
      true,
    );
  });

  it('state: exhausted at ≤ 0, low under the threshold, otherwise normal', () => {
    expect(creditState(0, 1_000_000)).toBe('exhausted');
    expect(creditState(-150, 1_000_000)).toBe('exhausted');
    expect(creditState(199_999, 1_000_000)).toBe('low');
    expect(creditState(200_000, 1_000_000)).toBe('normal');
  });
});
