import { describe, expect, it } from 'vitest';
import { suggestName } from './names.ts';
import { parseSkillMd } from './skill-md.ts';

const md = (front: string, body = '# Lập báo giá\n\nCác bước…\n') => `---\n${front}\n---\n${body}`;
const codes = (text: string) =>
  parseSkillMd(text).checks.map((item) => `${item.level}:${item.check}`);

describe('parseSkillMd — frontmatter (spec "Frontmatter của SKILL.md")', () => {
  it('reads name, description and the title from the first # line', () => {
    const parsed = parseSkillMd(md('name: lap-bao-gia\ndescription: Soạn báo giá theo mẫu.'));
    expect(parsed.frontmatter).toMatchObject({
      name: 'lap-bao-gia',
      description: 'Soạn báo giá theo mẫu.',
    });
    expect(parsed.title).toBe('Lập báo giá');
    expect(parsed.checks[0]).toMatchObject({ check: 'FRONTMATTER_VALID', level: 'ok' });
  });

  it('falls back to name when the body has no # line', () => {
    expect(parseSkillMd(md('name: a\ndescription: b', 'no heading')).title).toBe('a');
  });

  it('missing description is an error', () => {
    expect(codes(md('name: lap-bao-gia'))).toContain('error:DESCRIPTION_MISSING');
    expect(codes(md('name: lap-bao-gia\ndescription: "  "'))).toContain(
      'error:DESCRIPTION_MISSING',
    );
  });

  it('name with capitals or accents is refused with a suggestion', () => {
    const parsed = parseSkillMd(md('name: Lập-Báo-Giá\ndescription: x'));
    expect(parsed.frontmatter).toBeNull();
    expect(parsed.checks).toContainEqual({
      check: 'NAME_FORMAT',
      level: 'error',
      params: { suggestion: 'lap-bao-gia' },
    });
  });

  it.each(['-abc', 'abc-', 'a--b', 'a_b', 'x'.repeat(65)])('name "%s" is refused', (name) => {
    expect(codes(md(`name: ${name}\ndescription: x`))).toContain('error:NAME_FORMAT');
  });

  it('missing name, description too long', () => {
    expect(codes(md('description: x'))).toContain('error:NAME_MISSING');
    expect(codes(md(`name: a\ndescription: ${'x'.repeat(1025)}`))).toContain(
      'error:DESCRIPTION_TOO_LONG',
    );
  });

  it('no frontmatter, unclosed frontmatter, broken YAML', () => {
    expect(codes('# Tiêu đề')).toEqual(['error:FRONTMATTER_MISSING']);
    expect(codes('---\nname: a\n')).toEqual(['error:FRONTMATTER_MISSING']);
    expect(codes(md('name: [a'))).toEqual(['error:FRONTMATTER_INVALID']);
    expect(codes(md('- a\n- b'))).toEqual(['error:FRONTMATTER_INVALID']);
  });

  it('accepts a BOM and CRLF line ends', () => {
    const parsed = parseSkillMd('﻿---\r\nname: a\r\ndescription: b\r\n---\r\n# T\r\n');
    expect(parsed.frontmatter?.name).toBe('a');
    expect(parsed.title).toBe('T');
  });
});

describe('parseSkillMd — optional fields (spec "Trường tuỳ chọn của frontmatter")', () => {
  it('accepts the standard optional fields', () => {
    const parsed = parseSkillMd(
      md(
        'name: a\ndescription: b\nlicense: MIT\ncompatibility: Cần Python 3\nallowed-tools: Read\nmetadata:\n  version: "1"',
      ),
    );
    expect(parsed.checks.filter((item) => item.level !== 'ok')).toEqual([]);
  });

  it('a field outside the standard is a warning and is kept', () => {
    const parsed = parseSkillMd(md('name: a\ndescription: b\nauthor: Lan'));
    expect(parsed.frontmatter?.author).toBe('Lan');
    expect(parsed.checks).toContainEqual({
      check: 'UNKNOWN_FIELD',
      level: 'warn',
      params: { field: 'author' },
    });
  });

  it('wrong optional field types are errors', () => {
    expect(codes(md('name: a\ndescription: b\nmetadata:\n  n: 1'))).toContain(
      'error:FIELD_INVALID',
    );
    expect(codes(md(`name: a\ndescription: b\ncompatibility: ${'x'.repeat(501)}`))).toContain(
      'error:FIELD_INVALID',
    );
    expect(codes(md('name: a\ndescription: b\nlicense: 3'))).toContain('error:FIELD_INVALID');
  });

  it('---js frontmatter is refused and never run', () => {
    const marker = globalThis as { __skillMdRan?: boolean };
    const text = '---js\n{ name: (globalThis.__skillMdRan = true, "a"), description: "b" }\n---\n';
    expect(codes(text)).toEqual(['error:FRONTMATTER_NOT_YAML']);
    expect(codes(text.replace('---js', '--- javascript'))).toEqual(['error:FRONTMATTER_NOT_YAML']);
    expect(marker.__skillMdRan).toBeUndefined();
  });

  it('YAML custom tags are not executed', () => {
    expect(codes(md('name: !!js/function "function(){}"\ndescription: b'))).toEqual([
      'error:FRONTMATTER_INVALID',
    ]);
  });

  it('SKILL.md over 200 KB is refused; over 500 lines is a warning', () => {
    expect(codes(md('name: a\ndescription: b', 'x'.repeat(205_000)))).toEqual([
      'error:SKILL_MD_TOO_LARGE',
    ]);
    expect(codes(md('name: a\ndescription: b', 'dòng\n'.repeat(600)))).toContain(
      'warn:SKILL_MD_LONG',
    );
  });
});

describe('suggestName', () => {
  it.each([
    ['Lập-Báo-Giá', 'lap-bao-gia'],
    ['Đối chiếu  hoá đơn!', 'doi-chieu-hoa-don'],
    ['--a__b--', 'a-b'],
  ])('%s → %s', (input, expected) => {
    expect(suggestName(input)).toBe(expected);
  });
});
