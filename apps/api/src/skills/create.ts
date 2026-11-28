import { type CompanyTx, isUniqueViolation, skills, skillVersions } from '@dw/db';
import { and, eq, isNull, sql } from '@dw/db/drizzle';
import {
  CHECKS,
  type Check,
  type CheckedPackage,
  checkPackage,
  error,
  ok as okCheck,
  type PackageFile,
} from '@dw/skills';
import { type Outcome, ok, rejected } from '../org/outcome.ts';
import { addFile, auditSkill } from './store.ts';

const sqlCompany = () => sql`app.current_company_id()`;

export const NAME_INDEX = 'skills_company_name_live_uq';

export const SKILL_ERRORS = {
  nameTaken: 'NAME_TAKEN',
  nameImmutable: 'NAME_IMMUTABLE',
  packageInvalid: 'PACKAGE_INVALID',
  packageTooLarge: 'PACKAGE_TOO_LARGE',
  draftChanged: 'DRAFT_CHANGED',
  skillArchived: 'SKILL_ARCHIVED',
  skillInUse: 'SKILL_IN_USE',
  versionNotPending: 'VERSION_NOT_PENDING',
  versionNotApproved: 'VERSION_NOT_APPROVED',
  noDraft: 'NO_DRAFT',
  scriptRiskHigh: 'SCRIPT_RISK_HIGH',
  skillMdPath: 'SKILL_MD_PATH',
} as const;

export const nameTaken = (): Outcome<never> =>
  rejected(409, SKILL_ERRORS.nameTaken, [{ path: 'name', message: 'name_taken' }]);
export const packageInvalid = (checks: readonly Check[]): Outcome<never> =>
  rejected(422, SKILL_ERRORS.packageInvalid, { checks });

/** Maps a unique violation of a skill write (two people creating one name) to 409. */
export function skillWriteError(error: unknown): Outcome<never> {
  if (isUniqueViolation(error, NAME_INDEX)) return nameTaken();
  if (
    isUniqueViolation(error, 'skill_versions_one_draft_uq') ||
    isUniqueViolation(error, 'skill_versions_skill_number_unique')
  ) {
    return rejected(409, SKILL_ERRORS.draftChanged);
  }
  if (isUniqueViolation(error, 'worker_skills_worker_skill_unique')) {
    return rejected(409, 'ALREADY_ASSIGNED');
  }
  throw error;
}

export async function liveNameTaken(tx: CompanyTx, name: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: skills.id })
    .from(skills)
    .where(and(eq(skills.name, name), isNull(skills.archivedAt)));
  return Boolean(row);
}

/** Package checks plus "name not yet in the library" (screen "Nhập .zip"). */
export async function checkNewPackage(
  tx: CompanyTx,
  files: readonly PackageFile[],
): Promise<CheckedPackage> {
  const checked = checkPackage(files);
  const name = checked.skill?.frontmatter?.name;
  if (!name) return checked;
  const taken = await liveNameTaken(tx, name);
  const nameCheck = taken
    ? error(CHECKS.nameTaken, undefined, { name })
    : okCheck(CHECKS.nameAvailable, { name });
  return { ...checked, ok: checked.ok && !taken, checks: [...checked.checks, nameCheck] };
}

export type CreateSource = 'skill.created' | 'skill.created_from_template' | 'skill.imported';

export type CreatedSkill = { readonly id: string; readonly name: string; readonly number: 1 };

/**
 * A new skill in the actor's company (taken from the session, never the body) with v1 as
 * its draft (spec "Tạo kỹ năng"). The package must pass every check; nothing is stored
 * otherwise.
 */
export async function createSkill(
  tx: CompanyTx,
  actor: { readonly memberId: string },
  files: readonly PackageFile[],
  source: CreateSource,
): Promise<Outcome<CreatedSkill>> {
  const checked = await checkNewPackage(tx, files);
  const name = checked.skill?.frontmatter?.name;
  if (checked.checks.some((item) => item.check === CHECKS.nameTaken)) return nameTaken();
  const frontmatter = checked.skill?.frontmatter;
  const title = checked.skill?.title;
  if (!checked.ok || !name || !frontmatter || !title) return packageInvalid(checked.checks);
  const [skill] = await tx
    .insert(skills)
    .values({
      companyId: sqlCompany(),
      name,
      title,
      createdByMemberId: actor.memberId,
    })
    .returning({ id: skills.id });
  if (!skill) throw new Error('skill insert returned nothing');
  const [version] = await tx
    .insert(skillVersions)
    .values({
      companyId: sqlCompany(),
      skillId: skill.id,
      number: 1,
      title,
      description: frontmatter.description,
      hasScripts: checked.hasScripts,
      suggestedRisk: checked.suggestedRisk,
      createdByMemberId: actor.memberId,
    })
    .returning({ id: skillVersions.id });
  if (!version) throw new Error('version insert returned nothing');
  for (const file of checked.files) await addFile(tx, version.id, file);
  await auditSkill(tx, actor.memberId, source, { type: 'skill', id: skill.id });
  await auditSkill(tx, actor.memberId, 'skill.version_created', {
    type: 'skill_version',
    id: version.id,
  });
  return ok({ id: skill.id, name, number: 1 });
}
