import { CHECKS, type Check, error } from './checks.ts';
import { MAX_DEPTH, MAX_PATH } from './limits.ts';

/** File rules inside a package (spec skill-package; 0.2 #059, #089; design D5). */

const TEXT_TYPES: Readonly<Record<string, string>> = {
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  tsv: 'text/tab-separated-values; charset=utf-8',
  json: 'application/json; charset=utf-8',
  yaml: 'application/yaml; charset=utf-8',
  yml: 'application/yaml; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  py: 'text/x-python; charset=utf-8',
};

type Signature = (bytes: Uint8Array) => boolean;
const startsWith =
  (...prefix: number[]): Signature =>
  (bytes) =>
    prefix.every((byte, index) => bytes[index] === byte);
const ascii = (text: string, offset = 0): Signature => {
  const codes = [...text].map((char) => char.charCodeAt(0));
  return (bytes) => codes.every((code, index) => bytes[offset + index] === code);
};
const zipFile = startsWith(0x50, 0x4b, 0x03, 0x04);

const BINARY_TYPES: Readonly<Record<string, { type: string; matches: Signature }>> = {
  xlsx: {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    matches: zipFile,
  },
  docx: {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    matches: zipFile,
  },
  pdf: { type: 'application/pdf', matches: ascii('%PDF-') },
  png: { type: 'image/png', matches: startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) },
  jpg: { type: 'image/jpeg', matches: startsWith(0xff, 0xd8, 0xff) },
  jpeg: { type: 'image/jpeg', matches: startsWith(0xff, 0xd8, 0xff) },
  gif: { type: 'image/gif', matches: (b) => ascii('GIF87a')(b) || ascii('GIF89a')(b) },
  webp: { type: 'image/webp', matches: (b) => ascii('RIFF')(b) && ascii('WEBP', 8)(b) },
};

export const SCRIPTS_DIR = 'scripts/';

const extensionOf = (path: string): string => {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
};

/** System junk dropped from zips (spec: "Zip tạo trên macOS"). */
export function isJunkPath(path: string): boolean {
  const segments = path.split('/');
  return (
    segments[0] === '__MACOSX' ||
    segments.at(-1) === '.DS_Store' ||
    (segments.at(-1)?.startsWith('._') ?? false)
  );
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what we reject
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Relative, inside the root, no `..`, no control characters, within length / depth. */
export function checkPath(path: string): Check | null {
  const segments = path.split('/');
  if (
    path === '' ||
    path.startsWith('/') ||
    path.includes('\\') ||
    /^[a-zA-Z]:/.test(path) ||
    CONTROL.test(path) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    return error(CHECKS.pathUnsafe, path);
  }
  if (path.length > MAX_PATH) return error(CHECKS.pathTooLong, path, { max: MAX_PATH });
  if (segments.length > MAX_DEPTH) return error(CHECKS.pathTooDeep, path, { max: MAX_DEPTH });
  return null;
}

/** Media type served for `path`; never text/html (design D6). Null when not allowed. */
export function mediaTypeOf(path: string): string | null {
  const ext = extensionOf(path);
  return TEXT_TYPES[ext] ?? BINARY_TYPES[ext]?.type ?? null;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });
function isUtf8(bytes: Uint8Array): boolean {
  try {
    utf8.decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export const isScriptPath = (path: string): boolean => path.startsWith(SCRIPTS_DIR);

/** Type rules for one file: extension allowed, text is UTF-8, binary matches its signature. */
export function checkFile(path: string, bytes: Uint8Array): Check | null {
  const pathCheck = checkPath(path);
  if (pathCheck) return pathCheck;
  const ext = extensionOf(path);
  if (isScriptPath(path)) {
    if (ext !== 'py') return error(CHECKS.scriptNotPython, path);
  } else if (ext === 'py') {
    return error(CHECKS.pythonOutsideScripts, path);
  }
  if (ext in TEXT_TYPES) return isUtf8(bytes) ? null : error(CHECKS.notUtf8, path);
  const binary = BINARY_TYPES[ext];
  if (!binary) return error(CHECKS.fileType, path);
  return binary.matches(bytes) ? null : error(CHECKS.contentMismatch, path);
}
