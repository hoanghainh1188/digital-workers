import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPackage, type PackageFile } from './package.ts';
import type { RiskLevel } from './risk.ts';

/**
 * The 10 Vietnamese sample skills (FR-03-04, design D10). Same for every company and
 * read-only: read once when first imported. Node only (the web gets them from the api).
 */

export interface SkillTemplate {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly suggestedRisk: RiskLevel;
  readonly files: readonly PackageFile[];
}

const ROOT = fileURLToPath(new URL('../templates/', import.meta.url));

/** Display order on the "Mẫu có sẵn" tab (design D10 table). */
export const TEMPLATE_NAMES = [
  'lap-bao-gia',
  'soan-hop-dong-tu-mau',
  'tom-tat-email',
  'tong-hop-bao-cao-ngay',
  'tra-loi-cau-hoi-noi-bo',
  'nhac-cong-no',
  'soan-bien-ban-hop',
  'kiem-tra-don-hang',
  'viet-bai-dang-san-pham',
  'tong-hop-cham-cong',
] as const;

function readTemplate(name: string): SkillTemplate {
  const dir = join(ROOT, name);
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const full = join(entry.parentPath, entry.name);
      const path = relative(dir, full).split(sep).join('/');
      return { path, bytes: new Uint8Array(readFileSync(full)) };
    });
  const checked = checkPackage(files);
  if (!checked.ok || !checked.skill?.frontmatter || !checked.skill.title) {
    throw new Error(`skill template ${name} is invalid`);
  }
  return {
    name: checked.skill.frontmatter.name,
    title: checked.skill.title,
    description: checked.skill.frontmatter.description,
    suggestedRisk: checked.suggestedRisk,
    files: checked.files,
  };
}

let cache: readonly SkillTemplate[] | null = null;

export function skillTemplates(): readonly SkillTemplate[] {
  cache ??= TEMPLATE_NAMES.map(readTemplate);
  return cache;
}

export function findTemplate(name: string): SkillTemplate | undefined {
  return skillTemplates().find((template) => template.name === name);
}
