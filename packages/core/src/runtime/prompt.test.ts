import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, type WorkerProfileForPrompt } from './prompt.ts';

const profile: WorkerProfileForPrompt = {
  workerName: 'Minh · Báo giá',
  companyName: 'Gốm An Phú',
  departmentName: 'Kinh doanh',
  jobDescription: 'Lập báo giá gốm sứ cho khách sỉ.\nGửi bản nháp cho trưởng phòng.',
  voicePreset: 'polite',
  voiceCustom: null,
  status: 'probation',
};
const now = new Date('2026-11-28T03:05:00Z');

describe('buildSystemPrompt (design D8.1)', () => {
  it('matches the snapshot: rules, profile, probation, Vietnam time, skill names only', () => {
    const prompt = buildSystemPrompt(
      profile,
      [{ name: 'lap-bao-gia', description: 'Lập báo giá theo bảng giá hiện hành' }],
      now,
    );
    expect(prompt).toMatchSnapshot();
    expect(prompt).toContain('10:05');
    expect(prompt).toContain('Bạn đang thử việc');
    expect(prompt).toContain('- lap-bao-gia: Lập báo giá theo bảng giá hiện hành');
  });

  it('never contains SKILL.md content, only what it is given', () => {
    const prompt = buildSystemPrompt({ ...profile, status: 'active' }, [], now);
    expect(prompt).not.toContain('thử việc:');
    expect(prompt).toContain('chưa được giao kỹ năng nào');
  });

  it('a custom voice replaces the preset', () => {
    const prompt = buildSystemPrompt({ ...profile, voiceCustom: 'Vui vẻ, có emoji' }, [], now);
    expect(prompt).toContain('Giọng văn: Vui vẻ, có emoji');
    expect(prompt).not.toContain('xưng "em"');
  });
});
