import { describe, expect, it } from 'vitest';
import { type ChatMember, type ChatWorker, canChatWith } from './chat-access.ts';

const SALES = 'dept-sales';
const ACCOUNTING = 'dept-accounting';
const person = (
  role: ChatMember['role'],
  departmentId: string | null,
  memberId: string = role,
): ChatMember => ({
  memberId,
  role,
  departmentId,
});
const worker = (status: ChatWorker['status'], departmentId = SALES): ChatWorker => ({
  status,
  departmentId,
});

describe('canChatWith (design D7, spec web-chat)', () => {
  it('probation: only people on the tester list, Owner and Admin included (#121)', () => {
    const viet = person('member', SALES, 'viet');
    expect(canChatWith(viet, worker('probation'), ['viet'])).toBe('ok');
    expect(canChatWith(person('member', SALES), worker('probation'), ['viet'])).toBe('not_tester');
    expect(canChatWith(person('owner', null), worker('probation'), ['viet'])).toBe('not_tester');
    expect(canChatWith(person('admin', null), worker('probation'), [])).toBe('not_tester');
    expect(canChatWith(person('owner', null, 'own'), worker('probation'), ['own'])).toBe('ok');
  });

  it('active: Owner / Admin everywhere, Manager in their department only (#120)', () => {
    expect(canChatWith(person('owner', null), worker('active', ACCOUNTING), [])).toBe('ok');
    expect(canChatWith(person('admin', null), worker('active', ACCOUNTING), [])).toBe('ok');
    expect(canChatWith(person('manager', SALES), worker('active', SALES), [])).toBe('ok');
    expect(canChatWith(person('manager', SALES), worker('active', ACCOUNTING), [])).toBe(
      'forbidden',
    );
  });

  it('active: a Member only when on the list (#119), whatever the department', () => {
    expect(canChatWith(person('member', SALES, 'viet'), worker('active'), ['viet'])).toBe('ok');
    expect(canChatWith(person('member', SALES, 'nam'), worker('active'), ['viet'])).toBe(
      'forbidden',
    );
  });

  it('draft: nobody, not even the Owner', () => {
    expect(canChatWith(person('owner', null, 'own'), worker('draft'), ['own'])).toBe('draft');
  });

  it('suspended / offboarded: same access as active (they answer with a notice, D5)', () => {
    expect(canChatWith(person('manager', SALES), worker('suspended'), [])).toBe('ok');
    expect(canChatWith(person('manager', SALES), worker('offboarded', ACCOUNTING), [])).toBe(
      'forbidden',
    );
  });
});
