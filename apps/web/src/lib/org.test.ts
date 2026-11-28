import { describe, expect, it } from 'vitest';
import { dayMonth, daysLeft, filterInvitations, type InvitationRow, seenLabel } from './org.ts';

const NOW = Date.parse('2026-11-28T10:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe('seenLabel', () => {
  it.each([
    [null, { key: 'users.seen.never' }],
    [hoursAgo(0.5), { key: 'users.seen.now' }],
    [hoursAgo(2), { key: 'users.seen.hours', n: 2 }],
    [hoursAgo(30), { key: 'users.seen.yesterday' }],
    [hoursAgo(24 * 3), { key: 'users.seen.days', n: 3 }],
    [hoursAgo(24 * 21), { key: 'users.seen.weeks', n: 3 }],
  ])('%s → %j', (iso, expected) => {
    expect(seenLabel(iso, NOW)).toEqual(expected);
  });
});

describe('daysLeft / dayMonth', () => {
  it('rounds up the days left and never goes negative', () => {
    expect(daysLeft(new Date(NOW + 4.2 * 86_400_000).toISOString(), NOW)).toBe(5);
    expect(daysLeft(new Date(NOW - 86_400_000).toISOString(), NOW)).toBe(0);
  });

  it('formats dd/mm', () => {
    expect(dayMonth('2026-11-12T08:00:00')).toBe('12/11');
  });
});

describe('filterInvitations', () => {
  const row = (over: Partial<InvitationRow>): InvitationRow => ({
    id: 'i',
    email: 'thanh.binh@gomanphu.vn',
    role: 'member',
    departmentId: 'd1',
    departmentName: 'Kinh doanh',
    state: 'pending',
    expiresAt: '',
    createdAt: '',
    ...over,
  });

  it('matches search, role and department; hides invitations for active / locked filters', () => {
    const rows = [
      row({ id: 'a' }),
      row({ id: 'b', role: 'admin', departmentId: null, email: 'x@y.vn' }),
    ];
    expect(filterInvitations(rows, { q: 'BINH' }).map((r) => r.id)).toEqual(['a']);
    expect(filterInvitations(rows, { role: 'admin' }).map((r) => r.id)).toEqual(['b']);
    expect(filterInvitations(rows, { department: 'none' }).map((r) => r.id)).toEqual(['b']);
    expect(filterInvitations(rows, { status: 'locked' })).toEqual([]);
    expect(filterInvitations(rows, { status: 'invited' })).toHaveLength(2);
  });
});
