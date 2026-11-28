import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { checkPackage } from './package.ts';
import { skillMd, text } from './test-support.ts';
import { readZip, writeZip } from './zip.ts';

const enc = (value: string) => new TextEncoder().encode(value);

/** Sets bit 0 (encrypted) of the general purpose flags in every central directory entry. */
function markEncrypted(zip: Uint8Array): Uint8Array {
  const copy = zip.slice();
  const view = new DataView(copy.buffer);
  for (let at = 0; at < copy.length - 4; at++) {
    if (view.getUint32(at, true) === 0x02014b50)
      view.setUint16(at + 8, view.getUint16(at + 8, true) | 1, true);
  }
  return copy;
}

describe('readZip', () => {
  it('reads stored and deflated entries, skipping folders and junk', () => {
    const zip = zipSync({
      'SKILL.md': [enc(skillMd()), { level: 0 }],
      'references/': new Uint8Array(0),
      'references/bang-gia.md': enc('# Bảng giá'.repeat(100)),
      '__MACOSX/._SKILL.md': enc('junk'),
    });
    const result = readZip(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((file) => file.path)).toEqual(['SKILL.md', 'references/bang-gia.md']);
    expect(new TextDecoder().decode(result.files[1]?.bytes)).toBe('# Bảng giá'.repeat(100));
  });

  it('zip slip names are read but the package is refused before anything is stored', () => {
    const result = readZip(
      zipSync({ 'SKILL.md': enc(skillMd()), '../../etc/passwd': enc('root') }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(checkPackage(result.files).checks).toContainEqual({
      check: 'PATH_UNSAFE',
      level: 'error',
      path: '../../etc/passwd',
    });
  });

  it('zip bomb: stops once the real inflated size passes the limit', () => {
    const bomb = zipSync({
      'SKILL.md': enc(skillMd()),
      'big.txt': new Uint8Array(51 * 1024 * 1024),
    });
    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect(readZip(bomb)).toEqual({
      ok: false,
      checks: [{ check: 'TOO_LARGE_UNPACKED', level: 'error', params: { max: 50 * 1024 * 1024 } }],
    });
  });

  it('does not trust the declared size', () => {
    const zip = zipSync({ 'a.txt': new Uint8Array(4096) });
    const view = new DataView(zip.buffer);
    for (let at = 0; at < zip.length - 4; at++) {
      if (view.getUint32(at, true) === 0x02014b50) view.setUint32(at + 24, 10, true);
    }
    expect(readZip(zip, { maxFiles: 200, maxUnpackedBytes: 1000 })).toMatchObject({ ok: false });
  });

  it('refuses symlinks and encrypted entries', () => {
    const link = zipSync({
      'SKILL.md': enc(skillMd()),
      'evil.md': [enc('/etc/passwd'), { os: 3, attrs: 0o120777 << 16 }],
    });
    expect(readZip(link)).toEqual({
      ok: false,
      checks: [{ check: 'SYMLINK_ENTRY', level: 'error', path: 'evil.md' }],
    });
    const locked = markEncrypted(zipSync({ 'SKILL.md': enc(skillMd()) }));
    expect(readZip(locked)).toEqual({
      ok: false,
      checks: [{ check: 'ENCRYPTED_ENTRY', level: 'error', path: 'SKILL.md' }],
    });
  });

  it('refuses too many files before inflating and garbage input', () => {
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i < 201; i++) many[`r/${i}.md`] = enc('x');
    expect(readZip(zipSync(many))).toMatchObject({
      ok: false,
      checks: [{ check: 'TOO_MANY_FILES' }],
    });
    expect(readZip(enc('not a zip at all, just text'))).toEqual({
      ok: false,
      checks: [{ check: 'ZIP_INVALID', level: 'error' }],
    });
  });
});

describe('writeZip', () => {
  const files = [text('references/bang-gia.md', '# Giá'), text('SKILL.md', skillMd())];

  it('round-trips the same content', () => {
    const result = readZip(writeZip(files));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((file) => [file.path, new TextDecoder().decode(file.bytes)])).toEqual([
      ['SKILL.md', skillMd()],
      ['references/bang-gia.md', '# Giá'],
    ]);
  });

  it('same files give the same bytes whatever the input order', () => {
    expect(writeZip(files)).toEqual(writeZip([...files].reverse()));
  });
});
