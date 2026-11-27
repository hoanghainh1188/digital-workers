import { describe, expect, it } from 'vitest';
import { createFailedLoginLimiter } from '../src/auth/failed-login-limiter.ts';

function clock() {
  let now = 0;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('failed sign-in limiter', () => {
  it('blocks an email after 10 failures within 15 minutes, case-insensitively', () => {
    const time = clock();
    const limiter = createFailedLoginLimiter({ now: time.now });
    for (let i = 0; i < 9; i += 1) limiter.recordFailure('An@Example.com');
    expect(limiter.isBlocked('an@example.com')).toBe(false);
    limiter.recordFailure(' an@example.com ');
    expect(limiter.isBlocked('AN@EXAMPLE.COM')).toBe(true);
    expect(limiter.isBlocked('other@example.com')).toBe(false);
  });

  it('unblocks when the 15-minute window ends', () => {
    const time = clock();
    const limiter = createFailedLoginLimiter({ now: time.now });
    for (let i = 0; i < 10; i += 1) limiter.recordFailure('a@x.vn');
    time.advance(15 * 60_000 - 1);
    expect(limiter.isBlocked('a@x.vn')).toBe(true);
    time.advance(1);
    expect(limiter.isBlocked('a@x.vn')).toBe(false);
  });

  it('a success clears the counter', () => {
    const limiter = createFailedLoginLimiter();
    for (let i = 0; i < 9; i += 1) limiter.recordFailure('a@x.vn');
    limiter.reset('a@x.vn');
    limiter.recordFailure('a@x.vn');
    expect(limiter.isBlocked('a@x.vn')).toBe(false);
  });
});
