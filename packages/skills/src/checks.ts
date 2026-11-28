/**
 * One line of the import / save check list (design D5). `check` is a stable code; the web
 * turns code + params into Vietnamese in its i18n file.
 */
export type CheckLevel = 'ok' | 'warn' | 'error';

export const CHECKS = {
  // package shape
  zipInvalid: 'ZIP_INVALID',
  tooLarge: 'TOO_LARGE',
  rootSkillMd: 'ROOT_SKILL_MD',
  skillMdInSubfolder: 'SKILL_MD_IN_SUBFOLDER',
  tooLargeUnpacked: 'TOO_LARGE_UNPACKED',
  tooManyFiles: 'TOO_MANY_FILES',
  skillMdTooLarge: 'SKILL_MD_TOO_LARGE',
  skillMdLong: 'SKILL_MD_LONG',
  // frontmatter
  frontmatterMissing: 'FRONTMATTER_MISSING',
  frontmatterNotYaml: 'FRONTMATTER_NOT_YAML',
  frontmatterInvalid: 'FRONTMATTER_INVALID',
  nameMissing: 'NAME_MISSING',
  nameFormat: 'NAME_FORMAT',
  nameImmutable: 'NAME_IMMUTABLE',
  nameTaken: 'NAME_TAKEN',
  nameAvailable: 'NAME_AVAILABLE',
  descriptionMissing: 'DESCRIPTION_MISSING',
  descriptionTooLong: 'DESCRIPTION_TOO_LONG',
  frontmatterValid: 'FRONTMATTER_VALID',
  fieldInvalid: 'FIELD_INVALID',
  unknownField: 'UNKNOWN_FIELD',
  // files
  fileType: 'FILE_TYPE',
  contentMismatch: 'CONTENT_MISMATCH',
  notUtf8: 'NOT_UTF8',
  scriptNotPython: 'SCRIPT_NOT_PYTHON',
  pythonOutsideScripts: 'PYTHON_OUTSIDE_SCRIPTS',
  hasScripts: 'HAS_SCRIPTS',
  pathUnsafe: 'PATH_UNSAFE',
  pathTooLong: 'PATH_TOO_LONG',
  pathTooDeep: 'PATH_TOO_DEEP',
  duplicatePath: 'DUPLICATE_PATH',
  encryptedEntry: 'ENCRYPTED_ENTRY',
  symlinkEntry: 'SYMLINK_ENTRY',
  filesValid: 'FILES_VALID',
} as const;
export type CheckCode = (typeof CHECKS)[keyof typeof CHECKS];

export type CheckParams = Readonly<Record<string, string | number>>;

export interface Check {
  readonly check: CheckCode;
  readonly level: CheckLevel;
  readonly path?: string;
  readonly params?: CheckParams;
}

export const ok = (check: CheckCode, params?: CheckParams): Check =>
  params ? { check, level: 'ok', params } : { check, level: 'ok' };
export const warn = (check: CheckCode, path?: string, params?: CheckParams): Check => ({
  check,
  level: 'warn',
  ...(path === undefined ? {} : { path }),
  ...(params === undefined ? {} : { params }),
});
export const error = (check: CheckCode, path?: string, params?: CheckParams): Check => ({
  check,
  level: 'error',
  ...(path === undefined ? {} : { path }),
  ...(params === undefined ? {} : { params }),
});

export const hasErrors = (checks: readonly Check[]): boolean =>
  checks.some((item) => item.level === 'error');
