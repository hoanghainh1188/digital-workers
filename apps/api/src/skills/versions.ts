import type { RiskLevel } from '@dw/core';
import {
  type CompanyTx,
  recordAudit,
  skills,
  skillVersions,
  workerSkills,
  workerSkillTarget,
  workers,
  workersHoldingSkill,
} from '@dw/db';
import { and, eq, inArray, sql } from '@dw/db/drizzle';
import {
  type Check,
  checkFile,
  checkPackage,
  type PackageFile,
  riskAllowed,
  SKILL_MD,
} from '@dw/skills';
import { notFound, type Outcome, ok, rejected } from '../org/outcome.ts';
import { packageInvalid, SKILL_ERRORS } from './create.ts';
import {
  addFile,
  auditSkill,
  copyFiles,
  loadSkill,
  loadVersion,
  loadVersions,
  readFiles,
  removeFile,
  type SkillRow,
  type VersionRow,
  versionFiles,
} from './store.ts';

/**
 * Versions and their lifecycle (design D2, D3): one draft edited in place, frozen once
 * submitted; one pointer `current_version_id`. Every write locks the skill row first.
 */

type Actor = { readonly memberId: string };

const encoder = new TextEncoder();
const archived = () => rejected(409, SKILL_ERRORS.skillArchived);
const draftChanged = () => rejected(409, SKILL_ERRORS.draftChanged);

async function lockedSkill(tx: CompanyTx, id: string): Promise<Outcome<SkillRow>> {
  const skill = await loadSkill(tx, id, 'update');
  if (!skill) return notFound;
  return skill.archivedAt ? archived() : ok(skill);
}

/**
 * The open draft at `revision`, or a new draft (next number, files copied from the newest
 * version) when there is none and `revision` is null (spec "Sửa kỹ năng tạo version mới").
 */
async function openDraft(
  tx: CompanyTx,
  actor: Actor,
  skill: SkillRow,
  revision: number | null,
): Promise<Outcome<VersionRow>> {
  const versions = await loadVersions(tx, skill.id);
  const draft = versions.find((v) => v.status === 'draft');
  if (draft) return draft.revision === revision ? ok(draft) : draftChanged();
  if (revision !== null) return draftChanged();
  const latest = versions[0];
  if (!latest) throw new Error(`skill ${skill.id} has no version`);
  const [created] = await tx
    .insert(skillVersions)
    .values({
      companyId: sql`app.current_company_id()`,
      skillId: skill.id,
      number: latest.number + 1,
      title: latest.title,
      description: latest.description,
      hasScripts: latest.hasScripts,
      suggestedRisk: latest.suggestedRisk,
      createdByMemberId: actor.memberId,
    })
    .returning();
  if (!created) throw new Error('draft insert returned nothing');
  await copyFiles(tx, latest.id, created.id);
  await auditSkill(tx, actor.memberId, 'skill.version_created', {
    type: 'skill_version',
    id: created.id,
  });
  return ok(created);
}

export type DraftSaved = {
  readonly number: number;
  readonly revision: number;
  readonly hasScripts: boolean;
  readonly suggestedRisk: RiskLevel;
  readonly checks: readonly Check[];
};

/**
 * Re-checks the draft as a whole after a change and stores the new columns. `next` is
 * the full file list after the change; `changed` the files to write.
 */
async function applyDraft(
  tx: CompanyTx,
  skill: SkillRow,
  draft: VersionRow,
  next: readonly PackageFile[],
  write: () => Promise<void>,
): Promise<Outcome<DraftSaved>> {
  const checked = checkPackage(next);
  if (!checked.ok) return packageInvalid(checked.checks);
  const frontmatter = checked.skill?.frontmatter;
  const title = checked.skill?.title;
  if (!frontmatter || !title) return packageInvalid(checked.checks);
  if (frontmatter.name !== skill.name) {
    return rejected(400, SKILL_ERRORS.nameImmutable, [{ path: 'name', message: 'name_immutable' }]);
  }
  await write();
  const revision = draft.revision + 1;
  await tx
    .update(skillVersions)
    .set({
      title,
      description: frontmatter.description,
      hasScripts: checked.hasScripts,
      suggestedRisk: checked.suggestedRisk,
      revision,
      updatedAt: sql`now()`,
    })
    .where(eq(skillVersions.id, draft.id));
  return ok({
    number: draft.number,
    revision,
    hasScripts: checked.hasScripts,
    suggestedRisk: checked.suggestedRisk,
    checks: checked.checks,
  });
}

async function draftPackage(tx: CompanyTx, draft: VersionRow): Promise<PackageFile[]> {
  return readFiles(tx, await versionFiles(tx, draft.id));
}

/** PUT /api/skills/:id/draft — writes SKILL.md of the draft. */
export async function saveDraft(
  tx: CompanyTx,
  actor: Actor,
  id: string,
  input: { skillMd: string; revision: number | null },
): Promise<Outcome<DraftSaved>> {
  const skill = await lockedSkill(tx, id);
  if (!skill.ok) return skill;
  const draft = await openDraft(tx, actor, skill.value, input.revision);
  if (!draft.ok) return draft;
  const skillMd = { path: SKILL_MD, bytes: encoder.encode(input.skillMd) };
  const others = (await draftPackage(tx, draft.value)).filter((file) => file.path !== SKILL_MD);
  return applyDraft(tx, skill.value, draft.value, [skillMd, ...others], async () => {
    await removeFile(tx, draft.value.id, SKILL_MD);
    await addFile(tx, draft.value.id, skillMd);
  });
}

const skillMdPath = () =>
  rejected(400, SKILL_ERRORS.skillMdPath, [{ path: 'path', message: 'skill_md_path' }]);

/** PUT /api/skills/:id/draft/files/* — adds or replaces one file (checked like a zip entry). */
export async function putDraftFile(
  tx: CompanyTx,
  actor: Actor,
  id: string,
  input: { path: string; bytes: Uint8Array; revision: number | null },
): Promise<Outcome<DraftSaved>> {
  if (input.path === SKILL_MD) return skillMdPath();
  const fileCheck = checkFile(input.path, input.bytes);
  if (fileCheck) return packageInvalid([fileCheck]);
  const skill = await lockedSkill(tx, id);
  if (!skill.ok) return skill;
  const draft = await openDraft(tx, actor, skill.value, input.revision);
  if (!draft.ok) return draft;
  const file = { path: input.path, bytes: input.bytes };
  const others = (await draftPackage(tx, draft.value)).filter((f) => f.path !== input.path);
  return applyDraft(tx, skill.value, draft.value, [...others, file], async () => {
    await removeFile(tx, draft.value.id, input.path);
    await addFile(tx, draft.value.id, file);
  });
}

/** DELETE /api/skills/:id/draft/files/*. */
export async function deleteDraftFile(
  tx: CompanyTx,
  actor: Actor,
  id: string,
  input: { path: string; revision: number | null },
): Promise<Outcome<DraftSaved>> {
  if (input.path === SKILL_MD) return skillMdPath();
  const skill = await lockedSkill(tx, id);
  if (!skill.ok) return skill;
  const draft = await openDraft(tx, actor, skill.value, input.revision);
  if (!draft.ok) return draft;
  const files = await draftPackage(tx, draft.value);
  if (!files.some((file) => file.path === input.path)) return notFound;
  const next = files.filter((file) => file.path !== input.path);
  return applyDraft(tx, skill.value, draft.value, next, () =>
    removeFile(tx, draft.value.id, input.path),
  );
}

const scriptRiskHigh = () =>
  rejected(400, SKILL_ERRORS.scriptRiskHigh, [{ path: 'risk', message: 'script_risk_high' }]);

/** POST /api/skills/:id/draft/submit — an older pending version becomes superseded. */
export async function submitDraft(
  tx: CompanyTx,
  actor: Actor,
  id: string,
  input: { revision: number; changeNote: string | null; proposedRisk: RiskLevel },
): Promise<Outcome<{ number: number }>> {
  const skill = await lockedSkill(tx, id);
  if (!skill.ok) return skill;
  const versions = await loadVersions(tx, id);
  const draft = versions.find((v) => v.status === 'draft');
  if (!draft) return rejected(409, SKILL_ERRORS.noDraft);
  if (draft.revision !== input.revision) return draftChanged();
  if (!riskAllowed(input.proposedRisk, draft.hasScripts)) return scriptRiskHigh();
  const pending = versions.find((v) => v.status === 'pending');
  if (pending) {
    await tx
      .update(skillVersions)
      .set({ status: 'superseded', updatedAt: sql`now()` })
      .where(eq(skillVersions.id, pending.id));
  }
  await tx
    .update(skillVersions)
    .set({
      status: 'pending',
      changeNote: input.changeNote,
      proposedRisk: input.proposedRisk,
      submittedByMemberId: actor.memberId,
      submittedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(skillVersions.id, draft.id));
  await auditSkill(tx, actor.memberId, 'skill.version_submitted', {
    type: 'skill_version',
    id: draft.id,
  });
  return ok({ number: draft.number });
}

/**
 * Keeps #088 true when the version in use changes: a script version never takes effect
 * for an active / suspended worker before review exists (change 11).
 */
async function suspendForScripts(tx: CompanyTx, actor: Actor, skillId: string): Promise<void> {
  const activeLike = tx
    .select({ id: workers.id })
    .from(workers)
    .where(inArray(workers.status, ['active', 'suspended']));
  const rows = await tx
    .update(workerSkills)
    .set({ status: 'suspended', decidedAt: sql`now()` })
    .where(
      and(
        eq(workerSkills.skillId, skillId),
        inArray(workerSkills.status, ['active', 'pending']),
        inArray(workerSkills.workerId, activeLike),
      ),
    )
    .returning({ workerId: workerSkills.workerId });
  for (const row of rows) {
    await recordAudit(tx, {
      actorMemberId: actor.memberId,
      action: 'worker_skill.suspended',
      ...workerSkillTarget(row.workerId, skillId),
      fields: ['status'],
    });
  }
}

async function pointAt(tx: CompanyTx, actor: Actor, skill: SkillRow, version: VersionRow) {
  await tx
    .update(skills)
    .set({ currentVersionId: version.id, title: version.title, updatedAt: sql`now()` })
    .where(eq(skills.id, skill.id));
  if (version.hasScripts) await suspendForScripts(tx, actor, skill.id);
}

async function pendingVersion(
  tx: CompanyTx,
  skillId: string,
  number: number,
): Promise<Outcome<VersionRow>> {
  const version = await loadVersion(tx, skillId, number);
  if (!version) return notFound;
  return version.status === 'pending' ? ok(version) : rejected(409, SKILL_ERRORS.versionNotPending);
}

/** POST /api/skills/:id/versions/:n/approve — Owner / Admin decide the risk (#056). */
export async function approveVersion(
  tx: CompanyTx,
  actor: Actor,
  id: string,
  number: number,
  risk: RiskLevel,
): Promise<Outcome<{ number: number; risk: RiskLevel }>> {
  const skill = await lockedSkill(tx, id);
  if (!skill.ok) return skill;
  const version = await pendingVersion(tx, id, number);
  if (!version.ok) return version;
  if (!riskAllowed(risk, version.value.hasScripts)) return scriptRiskHigh();
  await tx
    .update(skillVersions)
    .set({
      status: 'approved',
      everApproved: true,
      risk,
      decidedByMemberId: actor.memberId,
      decidedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(skillVersions.id, version.value.id));
  await pointAt(tx, actor, skill.value, version.value);
  await auditSkill(
    tx,
    actor.memberId,
    'skill.version_approved',
    { type: 'skill_version', id: version.value.id },
    ['risk', 'current_version_id'],
  );
  return ok({ number, risk });
}

/** POST /api/skills/:id/versions/:n/reject — reason required (#091), never audited. */
export async function rejectVersion(
  tx: CompanyTx,
  actor: Actor,
  id: string,
  number: number,
  reason: string,
): Promise<Outcome<{ number: number }>> {
  const skill = await lockedSkill(tx, id);
  if (!skill.ok) return skill;
  const version = await pendingVersion(tx, id, number);
  if (!version.ok) return version;
  await tx
    .update(skillVersions)
    .set({
      status: 'rejected',
      rejectReason: reason,
      decidedByMemberId: actor.memberId,
      decidedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(skillVersions.id, version.value.id));
  await auditSkill(tx, actor.memberId, 'skill.version_rejected', {
    type: 'skill_version',
    id: version.value.id,
  });
  return ok({ number });
}

/** POST /api/skills/:id/rollback — point back at a version that was approved (#090). */
export async function rollbackSkill(
  tx: CompanyTx,
  actor: Actor,
  id: string,
  number: number,
): Promise<Outcome<{ number: number }>> {
  const skill = await lockedSkill(tx, id);
  if (!skill.ok) return skill;
  const version = await loadVersion(tx, id, number);
  if (!version) return notFound;
  if (!version.everApproved) return rejected(409, SKILL_ERRORS.versionNotApproved);
  if (version.id !== skill.value.currentVersionId) {
    await pointAt(tx, actor, skill.value, version);
  }
  await auditSkill(tx, actor.memberId, 'skill.rolled_back', { type: 'skill', id }, [
    'current_version_id',
  ]);
  return ok({ number });
}

/** POST /api/skills/:id/archive — only when no live worker holds it (#060). */
export async function archiveSkill(
  tx: CompanyTx,
  actor: Actor,
  id: string,
): Promise<Outcome<{ id: string }>> {
  const skill = await lockedSkill(tx, id);
  if (!skill.ok) return skill;
  const holders = await workersHoldingSkill(tx, id);
  if (holders.length > 0) {
    return rejected(409, SKILL_ERRORS.skillInUse, { count: holders.length, workerIds: holders });
  }
  await tx
    .update(skills)
    .set({ archivedAt: sql`now()`, archivedByMemberId: actor.memberId, updatedAt: sql`now()` })
    .where(eq(skills.id, id));
  await auditSkill(tx, actor.memberId, 'skill.archived', { type: 'skill', id });
  return ok({ id });
}
