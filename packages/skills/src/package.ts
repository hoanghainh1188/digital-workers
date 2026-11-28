import { CHECKS, type Check, error, hasErrors, ok, warn } from './checks.ts';
import { checkFile, isJunkPath, isScriptPath } from './files.ts';
import { MAX_FILES, MAX_UNPACKED_BYTES, SKILL_MD } from './limits.ts';
import { type RiskLevel, suggestRisk } from './risk.ts';
import { type ParsedSkillMd, parseSkillMd } from './skill-md.ts';

/** Whole-package rules (spec skill-package; 0.2 #089, #094; design D5). */

export interface PackageFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface CheckedPackage {
  readonly ok: boolean;
  readonly checks: readonly Check[];
  /** Files with the package root applied, sorted by path; junk dropped. */
  readonly files: readonly PackageFile[];
  readonly skill: ParsedSkillMd | null;
  readonly hasScripts: boolean;
  readonly suggestedRisk: RiskLevel;
}

const decoder = new TextDecoder();

/**
 * Finds the package root: SKILL.md at the top, or exactly one top folder named like the
 * skill's `name` holding SKILL.md (#094). Returns the files relative to that root.
 */
function locateRoot(files: readonly PackageFile[]): {
  files: readonly PackageFile[];
  checks: Check[];
  skillMdPath: string | null;
} {
  if (files.some((file) => file.path === SKILL_MD)) {
    return { files, checks: [ok(CHECKS.rootSkillMd)], skillMdPath: SKILL_MD };
  }
  const tops = new Set(files.map((file) => file.path.split('/')[0]));
  const nested = files.find((file) => file.path.endsWith(`/${SKILL_MD}`));
  const [top] = tops;
  if (tops.size === 1 && top && files.every((file) => file.path.includes('/'))) {
    const inner = `${top}/${SKILL_MD}`;
    const skillMd = files.find((file) => file.path === inner);
    if (skillMd) {
      const parsed = parseSkillMd(decoder.decode(skillMd.bytes));
      if (parsed.frontmatter?.name === top) {
        const prefix = `${top}/`;
        return {
          files: files.map((file) => ({ path: file.path.slice(prefix.length), bytes: file.bytes })),
          checks: [ok(CHECKS.rootSkillMd)],
          skillMdPath: SKILL_MD,
        };
      }
    }
  }
  const found = nested?.path;
  return {
    files,
    checks: [
      found
        ? error(CHECKS.skillMdInSubfolder, found, { folder: found.slice(0, -SKILL_MD.length - 1) })
        : error(CHECKS.rootSkillMd),
    ],
    // Still read the nested SKILL.md so the list also reports its frontmatter problems.
    skillMdPath: found ?? null,
  };
}

function checkSizes(files: readonly PackageFile[]): Check[] {
  const checks: Check[] = [];
  if (files.length > MAX_FILES)
    checks.push(error(CHECKS.tooManyFiles, undefined, { max: MAX_FILES }));
  const total = files.reduce((sum, file) => sum + file.bytes.length, 0);
  if (total > MAX_UNPACKED_BYTES) {
    checks.push(error(CHECKS.tooLargeUnpacked, undefined, { max: MAX_UNPACKED_BYTES }));
  }
  return checks;
}

function checkDuplicates(files: readonly PackageFile[]): Check[] {
  const seen = new Set<string>();
  const checks: Check[] = [];
  for (const file of files) {
    const key = file.path.toLowerCase();
    if (seen.has(key)) checks.push(error(CHECKS.duplicatePath, file.path));
    seen.add(key);
  }
  return checks;
}

/**
 * Checks a whole package. Junk files are dropped first; one error anywhere makes `ok`
 * false and the caller must not store anything (spec: "từ chối cả gói").
 */
export function checkPackage(input: readonly PackageFile[]): CheckedPackage {
  const kept = input.filter((file) => !isJunkPath(file.path));
  const root = locateRoot(kept);
  const checks: Check[] = [
    ...root.checks,
    ...checkSizes(root.files),
    ...checkDuplicates(root.files),
  ];
  const fileChecks = root.files
    .map((file) => checkFile(file.path, file.bytes))
    .filter((item): item is Check => item !== null);
  checks.push(...fileChecks);
  const skillMd = root.skillMdPath
    ? root.files.find((file) => file.path === root.skillMdPath)
    : undefined;
  const skill = skillMd ? parseSkillMd(decoder.decode(skillMd.bytes)) : null;
  if (skill) checks.push(...skill.checks);
  const scripts = root.files.filter((file) => isScriptPath(file.path));
  const hasScripts = scripts.length > 0;
  if (hasScripts) checks.push(warn(CHECKS.hasScripts, undefined, { count: scripts.length }));
  if (fileChecks.length === 0) checks.push(ok(CHECKS.filesValid, { count: root.files.length }));
  const files = [...root.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    ok: !hasErrors(checks),
    checks,
    files,
    skill,
    hasScripts,
    suggestedRisk: suggestRisk({ hasScripts, body: skill?.body ?? '' }),
  };
}
