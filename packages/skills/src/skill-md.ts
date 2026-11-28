import matter from 'gray-matter';
import { CHECKS, type Check, error, hasErrors, ok, warn } from './checks.ts';
import { LONG_SKILL_MD_LINES, MAX_SKILL_MD_BYTES } from './limits.ts';
import { isValidName, suggestName } from './names.ts';

/**
 * Reads SKILL.md safely (design D4): the opening line must be a bare `---` (no `---js`),
 * only the YAML engine is enabled, and every other engine throws. js-yaml's safe schema
 * means no custom tags. The text itself is kept verbatim; nothing here rewrites it.
 */

export const DESCRIPTION_MAX = 1024;
export const COMPATIBILITY_MAX = 500;
const STANDARD_FIELDS = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
]);

export interface SkillFrontmatter {
  readonly name: string;
  readonly description: string;
  readonly [field: string]: unknown;
}

export interface ParsedSkillMd {
  readonly checks: readonly Check[];
  /** Present when the frontmatter has a valid `name` and `description`. */
  readonly frontmatter: SkillFrontmatter | null;
  /** First `# …` line of the body, else `name`. */
  readonly title: string | null;
  readonly body: string;
}

const refuse = (): never => {
  throw new Error('frontmatter must be YAML');
};
const MATTER_OPTIONS = {
  language: 'yaml',
  engines: { javascript: refuse, js: refuse, coffee: refuse, json: refuse, toml: refuse },
};

const OPENING = /^---\r?\n/;

function readFrontmatter(text: string): { data: unknown; body: string } | Check {
  if (!text.startsWith('---')) return error(CHECKS.frontmatterMissing);
  if (!OPENING.test(text)) return error(CHECKS.frontmatterNotYaml);
  if (!/\r?\n---[ \t]*(\r?\n|$)/.test(text.replace(OPENING, '\n'))) {
    return error(CHECKS.frontmatterMissing);
  }
  try {
    const file = matter(text, MATTER_OPTIONS);
    return { data: file.data, body: file.content };
  } catch {
    return error(CHECKS.frontmatterInvalid);
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

function checkOptional(data: Record<string, unknown>): Check[] {
  const checks: Check[] = [];
  const bad = (field: string) => checks.push(error(CHECKS.fieldInvalid, undefined, { field }));
  if ('license' in data && typeof data.license !== 'string') bad('license');
  if ('allowed-tools' in data && typeof data['allowed-tools'] !== 'string') bad('allowed-tools');
  if ('compatibility' in data) {
    const value = data.compatibility;
    if (typeof value !== 'string' || value.length < 1 || value.length > COMPATIBILITY_MAX) {
      bad('compatibility');
    }
  }
  if ('metadata' in data) {
    const value = data.metadata;
    if (!isPlainObject(value) || Object.values(value).some((item) => typeof item !== 'string')) {
      bad('metadata');
    }
  }
  for (const field of Object.keys(data)) {
    if (!STANDARD_FIELDS.has(field)) checks.push(warn(CHECKS.unknownField, undefined, { field }));
  }
  return checks;
}

function checkName(value: unknown): Check | null {
  if (value === undefined || value === null || value === '') return error(CHECKS.nameMissing);
  if (typeof value !== 'string' || !isValidName(value)) {
    return error(CHECKS.nameFormat, undefined, { suggestion: suggestName(String(value)) });
  }
  return null;
}

function checkDescription(value: unknown): Check | null {
  if (typeof value !== 'string' || value.trim() === '') return error(CHECKS.descriptionMissing);
  if (value.length > DESCRIPTION_MAX) {
    return error(CHECKS.descriptionTooLong, undefined, { max: DESCRIPTION_MAX });
  }
  return null;
}

export function titleOf(body: string): string | null {
  for (const line of body.split(/\r?\n/)) {
    const match = /^#[ \t]+(.+?)[ \t#]*$/.exec(line);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

export function parseSkillMd(raw: string): ParsedSkillMd {
  const text = raw.startsWith('﻿') ? raw.slice(1) : raw;
  const checks: Check[] = [];
  if (byteLength(text) > MAX_SKILL_MD_BYTES) {
    return {
      checks: [error(CHECKS.skillMdTooLarge, undefined, { max: MAX_SKILL_MD_BYTES })],
      frontmatter: null,
      title: null,
      body: '',
    };
  }
  const read = readFrontmatter(text);
  if ('check' in read) return { checks: [read], frontmatter: null, title: null, body: text };
  if (!isPlainObject(read.data)) {
    return { checks: [error(CHECKS.frontmatterInvalid)], frontmatter: null, title: null, body: '' };
  }
  const data = read.data;
  const nameCheck = checkName(data.name);
  const descriptionCheck = checkDescription(data.description);
  if (nameCheck) checks.push(nameCheck);
  if (descriptionCheck) checks.push(descriptionCheck);
  checks.push(...checkOptional(data));
  if (text.split('\n').length > LONG_SKILL_MD_LINES) {
    checks.push(warn(CHECKS.skillMdLong, undefined, { max: LONG_SKILL_MD_LINES }));
  }
  const valid = !hasErrors(checks);
  const name = typeof data.name === 'string' ? data.name : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  if (valid) checks.unshift(ok(CHECKS.frontmatterValid, { name, description }));
  return {
    checks,
    frontmatter: valid ? { ...data, name, description } : null,
    title: valid ? (titleOf(read.body) ?? name) : null,
    body: read.body,
  };
}
