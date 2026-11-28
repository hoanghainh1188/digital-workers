import { describe, expect, it } from 'vitest';
import { t, tf } from './t.ts';
import { vi } from './vi.ts';

describe('t()', () => {
  it('returns the Vietnamese string for a known key', () => {
    expect(t('app.tagline')).toBe('Nhân viên số cho doanh nghiệp Việt');
  });

  it('rejects unknown keys at compile time', () => {
    // @ts-expect-error — 'home.missing' is not a MessageKey; `pnpm typecheck` fails if this compiles.
    expect(t('home.missing')).toBeUndefined();
  });

  it('has no empty strings', () => {
    for (const value of Object.values(vi)) {
      expect(value.trim()).not.toBe('');
    }
  });
});

describe('tf()', () => {
  it('fills placeholders and leaves unknown ones', () => {
    expect(tf('users.expiresIn', { days: 5 })).toBe('Hết hạn sau 5 ngày');
    expect(tf('users.expiresIn', {})).toBe('Hết hạn sau {days} ngày');
  });
});
