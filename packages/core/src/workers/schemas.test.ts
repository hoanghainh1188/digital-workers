import { describe, expect, it } from 'vitest';
import { avatarColorFor, workerInitials, workerNameKey } from './names.ts';
import {
  extendProbationInput,
  testersInput,
  transitionInput,
  workerInput,
  workerPatchInput,
} from './schemas.ts';

const ID = '0b7f3c4e-8a1d-4c2b-9e6f-1a2b3c4d5e6f';

describe('workerNameKey (0.2 #049)', () => {
  it('treats case, outer spaces and inner runs of spaces alike', () => {
    expect(workerNameKey('  Minh · Báo giá ')).toBe(workerNameKey('minh ·  báo GIÁ'));
  });

  it('normalises decomposed Vietnamese letters (NFD) to the same key as NFC', () => {
    const nfd = 'Quang · Tin nhắn Tết'.normalize('NFD');
    expect(workerNameKey(nfd)).toBe(workerNameKey('quang · tin nhắn tết'));
    expect(workerNameKey(nfd)).toBe('quang · tin nhắn tết');
  });

  it('keeps different names apart', () => {
    expect(workerNameKey('Bảo · Hoá đơn')).not.toBe(workerNameKey('Bao · Hoa don'));
  });

  it('builds initials and a stable colour', () => {
    expect(workerInitials('Minh · Báo giá')).toBe('MB');
    expect(workerInitials('an')).toBe('A');
    expect(avatarColorFor('Minh · Báo giá')).toBe(avatarColorFor(' minh · báo giá'));
    expect(avatarColorFor('x')).toBeGreaterThanOrEqual(0);
  });
});

const issues = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) =>
  result.success ? [] : (result.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]);

describe('worker schemas', () => {
  it('name is 1–60 characters', () => {
    expect(issues(workerInput.safeParse({ name: ' ', departmentId: ID }))).toEqual([
      ['name', 'required'],
    ]);
    expect(issues(workerInput.safeParse({ name: 'a'.repeat(61), departmentId: ID }))).toEqual([
      ['name', 'too_long'],
    ]);
    expect(workerInput.parse({ name: ' Bảo · Hoá đơn ', departmentId: ID })).toEqual({
      name: 'Bảo · Hoá đơn',
      departmentId: ID,
      templateId: null,
    });
  });

  it('job description ≤ 4.000, voice ≤ 500, budget an integer 0–100.000.000', () => {
    expect(
      issues(workerPatchInput.safeParse({ revision: 1, jobDescription: 'a'.repeat(4001) })),
    ).toEqual([['jobDescription', 'too_long']]);
    expect(
      workerPatchInput.safeParse({ revision: 1, jobDescription: 'a'.repeat(4000) }).success,
    ).toBe(true);
    expect(
      issues(workerPatchInput.safeParse({ revision: 1, voiceCustom: 'a'.repeat(501) })),
    ).toEqual([['voiceCustom', 'too_long']]);
    expect(issues(workerPatchInput.safeParse({ revision: 1, monthlyBudgetVnd: 150000.5 }))).toEqual(
      [['monthlyBudgetVnd', 'budget_integer']],
    );
    expect(
      issues(workerPatchInput.safeParse({ revision: 1, monthlyBudgetVnd: 100_000_001 })),
    ).toEqual([['monthlyBudgetVnd', 'budget_range']]);
    expect(issues(workerPatchInput.safeParse({ revision: 1, monthlyBudgetVnd: -1 }))).toEqual([
      ['monthlyBudgetVnd', 'budget_range'],
    ]);
    expect(workerPatchInput.safeParse({ revision: 1, monthlyBudgetVnd: 0 }).success).toBe(true);
  });

  it('a patch needs a revision and at least one field', () => {
    expect(workerPatchInput.safeParse({ revision: 1 }).success).toBe(false);
    expect(workerPatchInput.safeParse({ name: 'X' }).success).toBe(false);
    expect(workerPatchInput.safeParse({ revision: 1, managerMemberId: null }).success).toBe(true);
  });

  it('transition reason ≤ 500 and the event must change status', () => {
    expect(
      issues(
        transitionInput.safeParse({
          event: 'suspend',
          expectedStatus: 'active',
          reason: 'a'.repeat(501),
        }),
      ),
    ).toEqual([['reason', 'too_long']]);
    expect(
      transitionInput.safeParse({ event: 'propose', expectedStatus: 'probation' }).success,
    ).toBe(false);
    expect(
      transitionInput.parse({ event: 'suspend', expectedStatus: 'active', reason: '  ' }),
    ).toEqual({
      event: 'suspend',
      expectedStatus: 'active',
      reason: null,
      confirmName: null,
    });
  });

  it('extension is 7 or 14 days only', () => {
    expect(extendProbationInput.safeParse({ days: 7 }).success).toBe(true);
    expect(extendProbationInput.safeParse({ days: 14 }).success).toBe(true);
    expect(issues(extendProbationInput.safeParse({ days: 10 }))).toEqual([
      ['days', 'days_invalid'],
    ]);
  });

  it('testers are at most 10', () => {
    const ids = Array.from({ length: 11 }, (_, i) =>
      ID.replace(/f$/, i.toString(16)).replace(/^0/, String(i % 10)),
    );
    expect(issues(testersInput.safeParse({ memberIds: ids }))).toEqual([['memberIds', 'too_many']]);
    expect(testersInput.parse({ memberIds: [ID, ID] })).toEqual({ memberIds: [ID] });
  });
});
