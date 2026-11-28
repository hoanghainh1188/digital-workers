import { describe, expect, it } from 'vitest';
import {
  approveVersionInput,
  createSkillInput,
  rejectVersionInput,
  rollbackInput,
  saveDraftInput,
  skillListQuery,
  submitDraftInput,
} from './schemas.ts';

describe('skill input schemas', () => {
  it('create needs SKILL.md text', () => {
    expect(createSkillInput.safeParse({ skillMd: '' }).success).toBe(false);
    expect(createSkillInput.safeParse({ skillMd: '---\nname: a\n---' }).success).toBe(true);
    expect(createSkillInput.safeParse({ skillMd: 'x', companyId: 'b' }).success).toBe(false);
  });

  it('draft save carries the revision it started from', () => {
    expect(saveDraftInput.parse({ skillMd: 'x', revision: null }).revision).toBeNull();
    expect(saveDraftInput.safeParse({ skillMd: 'x' }).success).toBe(false);
    expect(saveDraftInput.safeParse({ skillMd: 'x', revision: -1 }).success).toBe(false);
  });

  it('submit: blank note becomes null, risk is one of three levels', () => {
    const parsed = submitDraftInput.parse({ revision: 2, changeNote: '  ', proposedRisk: 'low' });
    expect(parsed.changeNote).toBeNull();
    expect(submitDraftInput.safeParse({ revision: 2, proposedRisk: 'extreme' }).success).toBe(
      false,
    );
  });

  it('approve needs a risk; reject needs a reason (#091)', () => {
    expect(approveVersionInput.safeParse({}).success).toBe(false);
    expect(approveVersionInput.parse({ risk: 'high' }).risk).toBe('high');
    const blank = rejectVersionInput.safeParse({ reason: '   ' });
    expect(blank.success).toBe(false);
    expect(blank.error?.issues[0]?.message).toBe('required');
    expect(rejectVersionInput.parse({ reason: ' chiết khấu sai ' }).reason).toBe('chiết khấu sai');
  });

  it('rollback needs a positive version number', () => {
    expect(rollbackInput.safeParse({ versionNumber: 0 }).success).toBe(false);
    expect(rollbackInput.parse({ versionNumber: 1 }).versionNumber).toBe(1);
  });

  it('list query filters', () => {
    expect(skillListQuery.parse({ risk: 'high' })).toEqual({ risk: 'high', archived: false });
    expect(skillListQuery.parse({ archived: 'true' }).archived).toBe(true);
    expect(skillListQuery.safeParse({ status: 'gone' }).success).toBe(false);
  });
});
