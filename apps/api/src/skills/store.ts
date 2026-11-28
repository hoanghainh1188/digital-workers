import { createHash } from 'node:crypto';
import {
  type CompanyTx,
  recordAudit,
  skillBlobs,
  skills,
  skillVersionFiles,
  skillVersions,
} from '@dw/db';
import { and, asc, desc, eq, inArray, sql } from '@dw/db/drizzle';
import { mediaTypeOf, type PackageFile, SKILL_MD } from '@dw/skills';

/** Row access for skills (design D1). Every query runs in a company transaction (RLS). */

export type SkillRow = typeof skills.$inferSelect;
export type VersionRow = typeof skillVersions.$inferSelect;
export type FileRow = typeof skillVersionFiles.$inferSelect;

export async function loadSkill(
  tx: CompanyTx,
  id: string,
  lock: 'update' | 'none' = 'none',
): Promise<SkillRow | null> {
  const query = tx.select().from(skills).where(eq(skills.id, id));
  const [row] = lock === 'update' ? await query.for('update') : await query;
  return row ?? null;
}

export async function loadVersions(tx: CompanyTx, skillId: string): Promise<VersionRow[]> {
  return tx
    .select()
    .from(skillVersions)
    .where(eq(skillVersions.skillId, skillId))
    .orderBy(desc(skillVersions.number));
}

export async function loadVersion(
  tx: CompanyTx,
  skillId: string,
  number: number,
): Promise<VersionRow | null> {
  const [row] = await tx
    .select()
    .from(skillVersions)
    .where(and(eq(skillVersions.skillId, skillId), eq(skillVersions.number, number)));
  return row ?? null;
}

export async function versionById(tx: CompanyTx, id: string): Promise<VersionRow | null> {
  const [row] = await tx.select().from(skillVersions).where(eq(skillVersions.id, id));
  return row ?? null;
}

export async function versionFiles(tx: CompanyTx, versionId: string): Promise<FileRow[]> {
  return tx
    .select()
    .from(skillVersionFiles)
    .where(eq(skillVersionFiles.versionId, versionId))
    .orderBy(asc(skillVersionFiles.path));
}

/** File bodies for `rows`, as package files (same order). */
export async function readFiles(tx: CompanyTx, rows: readonly FileRow[]): Promise<PackageFile[]> {
  if (rows.length === 0) return [];
  const blobs = await tx
    .select({ sha256: skillBlobs.sha256, content: skillBlobs.content })
    .from(skillBlobs)
    .where(inArray(skillBlobs.sha256, [...new Set(rows.map((row) => row.sha256))]));
  const bySha = new Map(blobs.map((blob) => [blob.sha256, blob.content]));
  return rows.map((row) => {
    const content = bySha.get(row.sha256);
    if (!content) throw new Error(`missing blob for ${row.path}`);
    return { path: row.path, bytes: new Uint8Array(content) };
  });
}

export async function readSkillMd(tx: CompanyTx, versionId: string): Promise<string> {
  const [row] = await tx
    .select()
    .from(skillVersionFiles)
    .where(and(eq(skillVersionFiles.versionId, versionId), eq(skillVersionFiles.path, SKILL_MD)));
  if (!row) return '';
  const [file] = await readFiles(tx, [row]);
  return new TextDecoder().decode(file?.bytes);
}

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Stores the blob of `file` (shared when the company already has it) and a file row. */
export async function addFile(tx: CompanyTx, versionId: string, file: PackageFile): Promise<void> {
  const sha256 = sha256Of(file.bytes);
  const content = Buffer.from(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength);
  await tx
    .insert(skillBlobs)
    .values({
      companyId: sql`app.current_company_id()`,
      sha256,
      size: file.bytes.length,
      content,
    })
    .onConflictDoNothing();
  await tx.insert(skillVersionFiles).values({
    companyId: sql`app.current_company_id()`,
    versionId,
    path: file.path,
    sha256,
    size: file.bytes.length,
    mediaType: mediaTypeOf(file.path) ?? 'application/octet-stream',
  });
}

export async function removeFile(tx: CompanyTx, versionId: string, path: string): Promise<void> {
  await tx
    .delete(skillVersionFiles)
    .where(and(eq(skillVersionFiles.versionId, versionId), eq(skillVersionFiles.path, path)));
}

/** Copies file rows (not blobs) from one version to another (design D2). */
export async function copyFiles(tx: CompanyTx, fromId: string, toId: string): Promise<void> {
  const rows = await versionFiles(tx, fromId);
  if (rows.length === 0) return;
  await tx
    .insert(skillVersionFiles)
    .values(rows.map(({ versionId: _versionId, ...row }) => ({ ...row, versionId: toId })));
}

/** AuditEvent of a skill action: ids and field names only (design D12). */
export async function auditSkill(
  tx: CompanyTx,
  actorMemberId: string,
  action: string,
  target: { readonly type: 'skill' | 'skill_version'; readonly id: string },
  fields?: readonly string[],
): Promise<void> {
  await recordAudit(tx, {
    actorMemberId,
    action,
    targetType: target.type,
    targetId: target.id,
    fields: fields ?? null,
  });
}
