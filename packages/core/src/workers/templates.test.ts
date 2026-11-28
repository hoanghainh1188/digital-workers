import { describe, expect, it } from 'vitest';
import { workerNameKey } from './names.ts';
import { JOB_DESCRIPTION_MAX, VOICE_PRESETS, WORKER_NAME_MAX } from './schemas.ts';
import { findWorkerTemplate, WORKER_TEMPLATES } from './templates.ts';

describe('worker templates (design D6)', () => {
  it('has the three stable ids', () => {
    expect(WORKER_TEMPLATES.map((t) => t.id)).toEqual([
      'quote-assistant',
      'internal-support',
      'report-digest',
    ]);
    expect(findWorkerTemplate('report-digest')?.suggestedName).toBe('Trợ lý tổng hợp báo cáo');
    expect(findWorkerTemplate('nope')).toBeUndefined();
  });

  it.each(WORKER_TEMPLATES)('$id has a valid description, name and voice', (template) => {
    expect(template.jobDescription.trim().length).toBeGreaterThan(0);
    expect(template.jobDescription.length).toBeLessThanOrEqual(JOB_DESCRIPTION_MAX);
    expect(template.suggestedName.length).toBeLessThanOrEqual(WORKER_NAME_MAX);
    expect(VOICE_PRESETS).toContain(template.voicePreset);
  });

  it('suggested names do not collide', () => {
    const keys = WORKER_TEMPLATES.map((t) => workerNameKey(t.suggestedName));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
