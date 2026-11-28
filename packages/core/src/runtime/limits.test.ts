import { describe, expect, it } from 'vitest';
import { checkTaskLimits, DEFAULT_TASK_LIMITS } from './limits.ts';

const start = 1_000_000;

describe('checkTaskLimits (design D6, 0.2 #123)', () => {
  it('allows the 12th call, stops before a 13th', () => {
    const progress = { steps: 11, chargeVnd: 0, startedAtMs: start };
    expect(checkTaskLimits(progress, DEFAULT_TASK_LIMITS, start)).toBeNull();
    expect(checkTaskLimits({ ...progress, steps: 12 }, DEFAULT_TASK_LIMITS, start)).toBe(
      'max_steps',
    );
  });

  it('stops before the next call once 8.000đ is reached (e.g. 9.000đ)', () => {
    const progress = { steps: 3, chargeVnd: 7_999, startedAtMs: start };
    expect(checkTaskLimits(progress, DEFAULT_TASK_LIMITS, start)).toBeNull();
    expect(checkTaskLimits({ ...progress, chargeVnd: 9_000 }, DEFAULT_TASK_LIMITS, start)).toBe(
      'max_charge',
    );
  });

  it('stops after 180 seconds', () => {
    const progress = { steps: 1, chargeVnd: 0, startedAtMs: start };
    expect(checkTaskLimits(progress, DEFAULT_TASK_LIMITS, start + 179_999)).toBeNull();
    expect(checkTaskLimits(progress, DEFAULT_TASK_LIMITS, start + 180_000)).toBe('max_seconds');
  });
});
