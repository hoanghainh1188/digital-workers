import type { CompanyTx } from '@dw/db';
import { type Check, type PackageFile, type RiskLevel, readZip, writeZip } from '@dw/skills';
import { findTemplate, skillTemplates } from '@dw/skills/templates';
import { notFound, type Outcome, ok } from '../org/outcome.ts';
import { type CreatedSkill, checkNewPackage, createSkill, packageInvalid } from './create.ts';
import {
  auditSkill,
  loadSkill,
  loadVersion,
  readFiles,
  versionById,
  versionFiles,
} from './store.ts';

/** Import / export / templates / file download (spec skill-package, design D5, D6, D10). */

type Actor = { readonly memberId: string };

export type ImportPreview = {
  readonly ok: boolean;
  readonly checks: readonly Check[];
  readonly summary: {
    readonly name: string | null;
    readonly title: string | null;
    readonly description: string | null;
    readonly fileCount: number;
    readonly unpackedBytes: number;
    readonly hasScripts: boolean;
    readonly suggestedRisk: RiskLevel;
  };
};

async function inspect(
  tx: CompanyTx,
  zip: Uint8Array,
): Promise<{ files: PackageFile[]; preview: ImportPreview }> {
  const read = readZip(zip);
  if (!read.ok) {
    return {
      files: [],
      preview: {
        ok: false,
        checks: read.checks,
        summary: {
          name: null,
          title: null,
          description: null,
          fileCount: 0,
          unpackedBytes: 0,
          hasScripts: false,
          suggestedRisk: 'low',
        },
      },
    };
  }
  const checked = await checkNewPackage(tx, read.files);
  return {
    files: [...read.files],
    preview: {
      ok: checked.ok,
      checks: checked.checks,
      summary: {
        name: checked.skill?.frontmatter?.name ?? null,
        title: checked.skill?.title ?? null,
        description: checked.skill?.frontmatter?.description ?? null,
        fileCount: checked.files.length,
        unpackedBytes: checked.files.reduce((sum, file) => sum + file.bytes.length, 0),
        hasScripts: checked.hasScripts,
        suggestedRisk: checked.suggestedRisk,
      },
    },
  };
}

/**
 * POST /api/skills/import[?dryRun=1]. The server checks everything again on the real
 * call and keeps no state between the two (design D5). Any error → 422, nothing stored.
 */
export async function importSkill(
  tx: CompanyTx,
  actor: Actor,
  zip: Uint8Array,
  dryRun: boolean,
): Promise<Outcome<ImportPreview | (CreatedSkill & { checks: readonly Check[] })>> {
  const { files, preview } = await inspect(tx, zip);
  if (!preview.ok) return packageInvalid(preview.checks);
  if (dryRun) return ok(preview);
  const created = await createSkill(tx, actor, files, 'skill.imported');
  return created.ok ? ok({ ...created.value, checks: preview.checks }) : created;
}

export type TemplateCard = {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly suggestedRisk: RiskLevel;
  readonly files: readonly string[];
};

/** GET /api/skill-templates. */
export function listTemplates(): { templates: TemplateCard[] } {
  return {
    templates: skillTemplates().map((template) => ({
      name: template.name,
      title: template.title,
      description: template.description,
      suggestedRisk: template.suggestedRisk,
      files: template.files.map((file) => file.path),
    })),
  };
}

/** POST /api/skill-templates/:name/use — a company draft with the template's content. */
export async function useTemplate(
  tx: CompanyTx,
  actor: Actor,
  name: string,
): Promise<Outcome<CreatedSkill>> {
  const template = findTemplate(name);
  if (!template) return notFound;
  return createSkill(tx, actor, template.files, 'skill.created_from_template');
}

/** Version `number`, or the version in use when null (then 404 if none). */
async function versionFor(tx: CompanyTx, skillId: string, number: number | null) {
  const skill = await loadSkill(tx, skillId);
  if (!skill) return null;
  const version =
    number === null
      ? skill.currentVersionId
        ? await versionById(tx, skill.currentVersionId)
        : null
      : await loadVersion(tx, skillId, number);
  return version ? { skill, version } : null;
}

export type ExportedZip = { readonly filename: string; readonly bytes: Uint8Array };

/** GET /api/skills/:id/export[?version=n] and …/versions/:n/export: SKILL.md at the root. */
export async function exportSkill(
  tx: CompanyTx,
  actor: Actor,
  skillId: string,
  number: number | null,
): Promise<Outcome<ExportedZip>> {
  const found = await versionFor(tx, skillId, number);
  if (!found) return notFound;
  const files = await readFiles(tx, await versionFiles(tx, found.version.id));
  await auditSkill(tx, actor.memberId, 'skill.exported', {
    type: 'skill_version',
    id: found.version.id,
  });
  return ok({
    filename: `${found.skill.name}-v${found.version.number}.zip`,
    bytes: writeZip(files),
  });
}

export type DownloadedFile = {
  readonly filename: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
};

/** GET /api/skills/:id/versions/:n/files/* — one file of a version. */
export async function downloadFile(
  tx: CompanyTx,
  skillId: string,
  number: number,
  path: string,
): Promise<Outcome<DownloadedFile>> {
  const found = await versionFor(tx, skillId, number);
  if (!found) return notFound;
  const row = (await versionFiles(tx, found.version.id)).find((file) => file.path === path);
  if (!row) return notFound;
  const [file] = await readFiles(tx, [row]);
  if (!file) return notFound;
  return ok({
    filename: path.slice(path.lastIndexOf('/') + 1),
    mediaType: row.mediaType,
    bytes: file.bytes,
  });
}
