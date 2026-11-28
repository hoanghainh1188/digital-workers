import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkPackage } from './package.ts';
import { skillTemplates, TEMPLATE_NAMES } from './templates.ts';

const decoder = new TextDecoder();
/** Suggested risk per template (design D10 table). */
const EXPECTED_RISK = {
  'lap-bao-gia': 'medium',
  'soan-hop-dong-tu-mau': 'low',
  'tom-tat-email': 'medium',
  'tong-hop-bao-cao-ngay': 'medium',
  'tra-loi-cau-hoi-noi-bo': 'low',
  'nhac-cong-no': 'medium',
  'soan-bien-ban-hop': 'low',
  'kiem-tra-don-hang': 'medium',
  'viet-bai-dang-san-pham': 'low',
  'tong-hop-cham-cong': 'medium',
} as const;

describe('skill templates (FR-03-04, design D10)', () => {
  const templates = skillTemplates();

  it('has the 10 templates, every folder is listed, names are unique', () => {
    const dirs = readdirSync(fileURLToPath(new URL('../templates/', import.meta.url)));
    expect(templates.map((t) => t.name)).toEqual([...TEMPLATE_NAMES]);
    expect([...dirs].sort()).toEqual([...TEMPLATE_NAMES].sort());
    expect(new Set(templates.map((t) => t.name)).size).toBe(10);
  });

  it.each(TEMPLATE_NAMES)('%s passes every package check and has no scripts/', (name) => {
    const template = templates.find((t) => t.name === name);
    const result = checkPackage(template?.files ?? []);
    expect(result.checks.filter((c) => c.level !== 'ok')).toEqual([]);
    expect(result.hasScripts).toBe(false);
    expect(template?.suggestedRisk).toBe(EXPECTED_RISK[name]);
  });

  it.each(TEMPLATE_NAMES)('%s is in Vietnamese with the four sections', (name) => {
    const template = templates.find((t) => t.name === name);
    const skillMd = decoder.decode(template?.files.find((f) => f.path === 'SKILL.md')?.bytes);
    for (const section of ['## Khi nào dùng', '## Các bước', '## Không làm', '## Đầu ra']) {
      expect(skillMd).toContain(section);
    }
    expect(template?.title).toMatch(/[ăâđêôơưáàảãạéèẻẽẹíìỉĩịóòỏõọúùủũụýỳỷỹỵ]/i);
  });

  it('reference files start with the "replace this" line', () => {
    for (const template of templates) {
      for (const file of template.files.filter((f) => f.path.startsWith('references/'))) {
        expect(decoder.decode(file.bytes).split('\n')[0]).toBe(
          'Thay nội dung này bằng tài liệu của công ty bạn.',
        );
      }
    }
  });
});
