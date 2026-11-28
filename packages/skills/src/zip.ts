import { Inflate, zipSync } from 'fflate';
import { CHECKS, type Check, error } from './checks.ts';
import { isJunkPath } from './files.ts';
import { MAX_FILES, MAX_UNPACKED_BYTES } from './limits.ts';
import type { PackageFile } from './package.ts';

/**
 * Zip reading and writing (design D5, 0.2 #086). We read the central directory ourselves
 * so flags and file attributes are visible before anything is inflated (encrypted entries,
 * symlinks), and inflate with fflate in chunks while counting the real bytes: the sizes a
 * zip declares are never trusted, and going over a limit stops at once.
 */

export interface ZipLimits {
  readonly maxFiles: number;
  readonly maxUnpackedBytes: number;
}
const DEFAULT_LIMITS: ZipLimits = { maxFiles: MAX_FILES, maxUnpackedBytes: MAX_UNPACKED_BYTES };

export type ReadZipResult =
  | { readonly ok: true; readonly files: readonly PackageFile[] }
  | { readonly ok: false; readonly checks: readonly Check[] };

class ZipError extends Error {
  readonly result: Check;
  constructor(result: Check) {
    super(result.check);
    this.result = result;
  }
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const CHUNK = 64 * 1024;

interface Entry {
  readonly name: string;
  readonly flags: number;
  readonly method: number;
  readonly compressedSize: number;
  readonly externalAttrs: number;
  readonly localOffset: number;
}

const invalid = (): never => {
  throw new ZipError(error(CHECKS.zipInvalid));
};

function findEndOfCentralDirectory(view: DataView): number {
  const stop = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let at = view.byteLength - 22; at >= stop; at--) {
    if (view.getUint32(at, true) === EOCD) return at;
  }
  return invalid();
}

const nameDecoder = new TextDecoder('utf-8');

function readEntries(bytes: Uint8Array, view: DataView): Entry[] {
  const end = findEndOfCentralDirectory(view);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (count === 0xffff || at === 0xffffffff) invalid(); // zip64: not needed for ≤ 25 MB
  const entries: Entry[] = [];
  for (let index = 0; index < count; index++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL) invalid();
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const compressedSize = view.getUint32(at + 20, true);
    if (compressedSize === 0xffffffff) invalid();
    entries.push({
      flags: view.getUint16(at + 8, true),
      method: view.getUint16(at + 10, true),
      compressedSize,
      externalAttrs: view.getUint32(at + 38, true),
      localOffset: view.getUint32(at + 42, true),
      name: nameDecoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function entryData(bytes: Uint8Array, view: DataView, entry: Entry): Uint8Array {
  const at = entry.localOffset;
  if (at + 30 > bytes.length || view.getUint32(at, true) !== LOCAL) invalid();
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  const stop = start + entry.compressedSize;
  if (stop > bytes.length) invalid();
  return bytes.subarray(start, stop);
}

/** Inflates `data`, failing as soon as the running total passes `budget`. */
function inflate(data: Uint8Array, method: number, budget: number, tooLarge: Check): Uint8Array {
  if (method === 0) {
    if (data.length > budget) throw new ZipError(tooLarge);
    return data.slice();
  }
  if (method !== 8) invalid();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const stream = new Inflate((chunk) => {
    size += chunk.length;
    if (size > budget) throw new ZipError(tooLarge);
    chunks.push(chunk.slice());
  });
  try {
    for (let at = 0; at < data.length; at += CHUNK) {
      stream.push(data.subarray(at, at + CHUNK), at + CHUNK >= data.length);
    }
    if (data.length === 0) stream.push(new Uint8Array(0), true);
  } catch (cause) {
    if (cause instanceof ZipError) throw cause;
    invalid();
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

const isSymlink = (entry: Entry): boolean => ((entry.externalAttrs >>> 16) & S_IFMT) === S_IFLNK;

export function readZip(bytes: Uint8Array, limits: ZipLimits = DEFAULT_LIMITS): ReadZipResult {
  try {
    if (bytes.length < 22) invalid();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const entries = readEntries(bytes, view).filter(
      (entry) => !entry.name.endsWith('/') && !isJunkPath(entry.name),
    );
    if (entries.length > limits.maxFiles) {
      return {
        ok: false,
        checks: [error(CHECKS.tooManyFiles, undefined, { max: limits.maxFiles })],
      };
    }
    const refused: Check[] = [];
    for (const entry of entries) {
      if (entry.flags & 1) refused.push(error(CHECKS.encryptedEntry, entry.name));
      else if (isSymlink(entry)) refused.push(error(CHECKS.symlinkEntry, entry.name));
    }
    if (refused.length > 0) return { ok: false, checks: refused };
    const tooLarge = error(CHECKS.tooLargeUnpacked, undefined, { max: limits.maxUnpackedBytes });
    let remaining = limits.maxUnpackedBytes;
    const files: PackageFile[] = [];
    for (const entry of entries) {
      const content = inflate(entryData(bytes, view, entry), entry.method, remaining, tooLarge);
      remaining -= content.length;
      files.push({ path: entry.name, bytes: content });
    }
    return { ok: true, files };
  } catch (cause) {
    if (cause instanceof ZipError) return { ok: false, checks: [cause.result] };
    return { ok: false, checks: [error(CHECKS.zipInvalid)] };
  }
}

/** Same files → same bytes: sorted paths and a fixed time (design D5). */
const FIXED_TIME = new Date(2000, 0, 1, 0, 0, 0);

export function writeZip(files: readonly PackageFile[]): Uint8Array {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const input: Record<string, [Uint8Array, { mtime: Date; level: 6 }]> = {};
  for (const file of sorted) input[file.path] = [file.bytes, { mtime: FIXED_TIME, level: 6 }];
  return zipSync(input);
}
