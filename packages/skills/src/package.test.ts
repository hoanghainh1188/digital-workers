import { describe, expect, it } from 'vitest';
import { checkFile, mediaTypeOf } from './files.ts';
import { checkPackage } from './package.ts';
import { PNG, skillMd, text } from './test-support.ts';

const errors = (result: ReturnType<typeof checkPackage>) =>
  result.checks.filter((item) => item.level === 'error');

describe('checkFile — "Loại file đi kèm"', () => {
  it('accepts the allowed types', () => {
    expect(checkFile('references/bang-gia.md', new TextEncoder().encode('# Giá'))).toBeNull();
    expect(checkFile('assets/logo.png', PNG)).toBeNull();
    expect(checkFile('assets/a.pdf', new TextEncoder().encode('%PDF-1.7'))).toBeNull();
    expect(checkFile('assets/a.xlsx', Uint8Array.from([0x50, 0x4b, 3, 4, 0]))).toBeNull();
  });

  it('refuses executables with the path', () => {
    expect(checkFile('tools/setup.exe', Uint8Array.from([0x4d, 0x5a]))).toEqual({
      check: 'FILE_TYPE',
      level: 'error',
      path: 'tools/setup.exe',
    });
  });

  it('refuses SVG and HTML (#089)', () => {
    expect(checkFile('assets/a.svg', new TextEncoder().encode('<svg/>'))?.check).toBe('FILE_TYPE');
    expect(checkFile('a.html', new TextEncoder().encode('<p>'))?.check).toBe('FILE_TYPE');
  });

  it('refuses a fake extension and non-UTF-8 text', () => {
    expect(checkFile('assets/logo.png', new TextEncoder().encode('not png'))?.check).toBe(
      'CONTENT_MISMATCH',
    );
    expect(checkFile('a.csv', Uint8Array.from([0xff, 0xfe, 0x41]))?.check).toBe('NOT_UTF8');
  });

  it('never serves text/html', () => {
    expect(mediaTypeOf('a.md')).toBe('text/markdown; charset=utf-8');
    expect(mediaTypeOf('a.html')).toBeNull();
  });
});

describe('checkFile — "Thư mục scripts"', () => {
  it('scripts/*.py is allowed, other scripts and stray .py are not', () => {
    expect(checkFile('scripts/doi_chieu.py', new TextEncoder().encode('print(1)'))).toBeNull();
    expect(checkFile('scripts/run.sh', new TextEncoder().encode('ls'))?.check).toBe(
      'SCRIPT_NOT_PYTHON',
    );
    expect(checkFile('tools/a.py', new TextEncoder().encode('x'))?.check).toBe(
      'PYTHON_OUTSIDE_SCRIPTS',
    );
  });

  it('a package with a script is accepted, flagged and high risk', () => {
    const result = checkPackage([text('SKILL.md', skillMd()), text('scripts/doi_chieu.py', 'x=1')]);
    expect(result.ok).toBe(true);
    expect(result.hasScripts).toBe(true);
    expect(result.suggestedRisk).toBe('high');
    expect(result.checks).toContainEqual({
      check: 'HAS_SCRIPTS',
      level: 'warn',
      params: { count: 1 },
    });
  });
});

describe('checkPackage — "Đường dẫn an toàn trong gói"', () => {
  it.each([
    '../../etc/passwd',
    '/etc/passwd',
    'a/../b.md',
    'a\\b.md',
    'C:/x.md',
    'a/\u0001.md',
    'a//b.md',
  ])('refuses %j', (path) => {
    const result = checkPackage([text('SKILL.md', skillMd()), text(path, 'x')]);
    expect(result.ok).toBe(false);
    expect(errors(result)[0]).toMatchObject({ check: 'PATH_UNSAFE' });
  });

  it('refuses paths that differ only by case', () => {
    const result = checkPackage([
      text('SKILL.md', skillMd()),
      text('references/A.md', 'x'),
      text('references/a.md', 'y'),
    ]);
    expect(errors(result)).toEqual([
      { check: 'DUPLICATE_PATH', level: 'error', path: 'references/a.md' },
    ]);
  });

  it('refuses too long and too deep paths', () => {
    expect(
      errors(checkPackage([text('SKILL.md', skillMd()), text(`${'a'.repeat(200)}.md`, 'x')]))[0]
        ?.check,
    ).toBe('PATH_TOO_LONG');
    expect(
      errors(checkPackage([text('SKILL.md', skillMd()), text('a/b/c/d/e/f.md', 'x')]))[0]?.check,
    ).toBe('PATH_TOO_DEEP');
  });

  it('drops macOS junk', () => {
    const result = checkPackage([
      text('SKILL.md', skillMd()),
      text('__MACOSX/._SKILL.md', 'junk'),
      text('.DS_Store', 'junk'),
      text('references/.DS_Store', 'junk'),
      text('references/bang-gia.md', 'x'),
    ]);
    expect(result.ok).toBe(true);
    expect(result.files.map((file) => file.path)).toEqual(['SKILL.md', 'references/bang-gia.md']);
  });
});

describe('checkPackage — package root (#094)', () => {
  it('accepts one top folder named like the skill and strips it', () => {
    const result = checkPackage([
      text('lap-bao-gia/SKILL.md', skillMd()),
      text('lap-bao-gia/references/bang-gia.md', 'x'),
    ]);
    expect(result.ok).toBe(true);
    expect(result.files.map((file) => file.path)).toEqual(['SKILL.md', 'references/bang-gia.md']);
  });

  it('refuses a folder with another name and still reports frontmatter problems', () => {
    const result = checkPackage([
      text('bao-gia/SKILL.md', '---\nname: lap-bao-gia\n---\n'),
      text('bao-gia/references/a.md', 'x'),
    ]);
    expect(errors(result)).toEqual([
      {
        check: 'SKILL_MD_IN_SUBFOLDER',
        level: 'error',
        path: 'bao-gia/SKILL.md',
        params: { folder: 'bao-gia' },
      },
      { check: 'DESCRIPTION_MISSING', level: 'error' },
    ]);
  });

  it('refuses SKILL.md nested deeper, or a top folder with files beside it', () => {
    expect(errors(checkPackage([text('a/b/SKILL.md', skillMd('b'))]))[0]?.check).toBe(
      'SKILL_MD_IN_SUBFOLDER',
    );
    expect(
      errors(checkPackage([text('lap-bao-gia/SKILL.md', skillMd()), text('readme.md', 'x')]))[0]
        ?.check,
    ).toBe('SKILL_MD_IN_SUBFOLDER');
    expect(errors(checkPackage([text('readme.md', 'x')]))).toEqual([
      { check: 'ROOT_SKILL_MD', level: 'error' },
    ]);
  });

  it('refuses more than 200 files', () => {
    const files = [
      text('SKILL.md', skillMd()),
      ...Array.from({ length: 200 }, (_, i) => text(`r/${i}.md`, 'x')),
    ];
    expect(errors(checkPackage(files))[0]?.check).toBe('TOO_MANY_FILES');
  });
});
