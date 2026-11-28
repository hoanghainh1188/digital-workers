import {
  actorMay,
  type RiskLevel,
  type SkillListQuery,
  type SkillStatus,
  type SkillVersionStatus,
  type WorkerSkillStatus,
} from '@dw/core';
import { type CompanyTx, skills, skillVersions, workerSkills, workers } from '@dw/db';
import { and, asc, eq, inArray, isNotNull, isNull, ne } from '@dw/db/drizzle';
import { notFound, type Outcome, ok } from '../org/outcome.ts';
import type { FreshActor } from '../workers/people.ts';
import { peopleById } from '../workers/people.ts';
import {
  loadSkill,
  loadVersion,
  loadVersions,
  readSkillMd,
  type SkillRow,
  type VersionRow,
  versionFiles,
} from './store.ts';

/** Read models for the library and detail pages (spec skill-library, design D9). */

export type SkillCard = {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly status: SkillStatus;
  readonly currentNumber: number | null;
  readonly pendingNumber: number | null;
  readonly draftNumber: number | null;
  readonly risk: RiskLevel;
  readonly hasScripts: boolean;
  readonly workerCount: number;
  readonly updatedAt: string;
};

type Summary = {
  current: VersionRow | null;
  pending: VersionRow | null;
  draft: VersionRow | null;
  latest: VersionRow;
};

function summarize(skill: SkillRow, versions: readonly VersionRow[]): Summary {
  const sorted = [...versions].sort((a, b) => b.number - a.number);
  const latest = sorted[0];
  if (!latest) throw new Error(`skill ${skill.id} has no version`);
  return {
    current: sorted.find((v) => v.id === skill.currentVersionId) ?? null,
    pending: sorted.find((v) => v.status === 'pending') ?? null,
    draft: sorted.find((v) => v.status === 'draft') ?? null,
    latest,
  };
}

/** Risk of the version in use, else of the newest version (spec "Mức rủi ro của kỹ năng"). */
const versionRisk = (version: VersionRow): RiskLevel =>
  version.risk ?? version.proposedRisk ?? version.suggestedRisk;

function statusOf(skill: SkillRow, summary: Summary): SkillStatus {
  if (skill.archivedAt) return 'archived';
  if (summary.current) return 'active';
  return summary.pending ? 'pending' : 'draft';
}

function card(skill: SkillRow, versions: readonly VersionRow[], workerCount: number): SkillCard {
  const summary = summarize(skill, versions);
  const shown = summary.current ?? summary.latest;
  return {
    id: skill.id,
    name: skill.name,
    title: skill.title,
    description: shown.description,
    status: statusOf(skill, summary),
    currentNumber: summary.current?.number ?? null,
    pendingNumber: summary.pending?.number ?? null,
    draftNumber: summary.draft?.number ?? null,
    risk: versionRisk(shown),
    hasScripts: shown.hasScripts,
    workerCount,
    updatedAt: (summary.latest.updatedAt ?? skill.updatedAt).toISOString(),
  };
}

const fold = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();

/** Active assignments per skill, not counting offboarded workers. */
async function workerCounts(
  tx: CompanyTx,
  skillIds: readonly string[],
): Promise<Map<string, number>> {
  if (skillIds.length === 0) return new Map();
  const rows = await tx
    .select({ skillId: workerSkills.skillId })
    .from(workerSkills)
    .innerJoin(workers, eq(workers.id, workerSkills.workerId))
    .where(
      and(
        inArray(workerSkills.skillId, [...skillIds]),
        eq(workerSkills.status, 'active'),
        ne(workers.status, 'offboarded'),
      ),
    );
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.skillId, (counts.get(row.skillId) ?? 0) + 1);
  return counts;
}

/** GET /api/skills — the company's library; archived skills only when asked for. */
export async function listSkills(
  tx: CompanyTx,
  query: SkillListQuery,
): Promise<{ skills: SkillCard[] }> {
  const rows = await tx
    .select()
    .from(skills)
    .where(query.archived ? isNotNull(skills.archivedAt) : isNull(skills.archivedAt))
    .orderBy(asc(skills.title));
  const ids = rows.map((row) => row.id);
  const versions =
    ids.length === 0
      ? []
      : await tx.select().from(skillVersions).where(inArray(skillVersions.skillId, ids));
  const counts = await workerCounts(tx, ids);
  const bySkill = Map.groupBy(versions, (version) => version.skillId);
  const needle = query.q ? fold(query.q) : null;
  const cards = rows
    .map((row) => card(row, bySkill.get(row.id) ?? [], counts.get(row.id) ?? 0))
    .filter(
      (item) => !needle || fold(`${item.name} ${item.title} ${item.description}`).includes(needle),
    )
    .filter((item) =>
      query.status === 'pending'
        ? item.pendingNumber !== null
        : !query.status || item.status === query.status,
    )
    .filter((item) => !query.risk || item.risk === query.risk);
  return { skills: cards };
}

type PersonRef = { readonly id: string; readonly name: string };

export type VersionEntry = {
  readonly number: number;
  readonly status: SkillVersionStatus;
  readonly changeNote: string | null;
  readonly risk: RiskLevel | null;
  readonly proposedRisk: RiskLevel | null;
  readonly suggestedRisk: RiskLevel;
  readonly hasScripts: boolean;
  readonly everApproved: boolean;
  readonly createdBy: PersonRef | null;
  readonly createdAt: string;
  readonly submittedBy: PersonRef | null;
  readonly submittedAt: string | null;
  readonly decidedBy: PersonRef | null;
  readonly decidedAt: string | null;
  readonly rejectReason: string | null;
};

export type SkillHolder = {
  readonly workerId: string;
  readonly workerName: string;
  readonly workerStatus: string;
  readonly departmentId: string;
  readonly status: WorkerSkillStatus;
  readonly assignedBy: PersonRef | null;
  readonly requestedAt: string;
};

export type SkillDetail = SkillCard & {
  readonly archived: boolean;
  readonly draftRevision: number | null;
  /** Version the page opens on: pending, else in use, else the draft. */
  readonly focusNumber: number;
  readonly versions: readonly VersionEntry[];
  /** Holders the viewer may see (worker.view scope); `holderCount` counts all of them. */
  readonly holders: readonly SkillHolder[];
  readonly holderCount: number;
};

async function holdersOf(tx: CompanyTx, actor: FreshActor, skillId: string) {
  const rows = await tx
    .select({
      workerId: workers.id,
      workerName: workers.name,
      workerStatus: workers.status,
      departmentId: workers.departmentId,
      status: workerSkills.status,
      assignedByMemberId: workerSkills.assignedByMemberId,
      requestedAt: workerSkills.requestedAt,
    })
    .from(workerSkills)
    .innerJoin(workers, eq(workers.id, workerSkills.workerId))
    .where(and(eq(workerSkills.skillId, skillId), ne(workers.status, 'offboarded')))
    .orderBy(asc(workers.name));
  const visible = rows.filter((row) => actorMay(actor, 'worker.view', row.departmentId));
  return { rows, visible };
}

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

/** GET /api/skills/:id. */
export async function skillDetail(
  tx: CompanyTx,
  actor: FreshActor,
  id: string,
): Promise<Outcome<SkillDetail>> {
  const skill = await loadSkill(tx, id);
  if (!skill) return notFound;
  const versions = await loadVersions(tx, id);
  const summary = summarize(skill, versions);
  const { rows, visible } = await holdersOf(tx, actor, id);
  const people = await peopleById(tx, [
    ...versions.flatMap((v) => [v.createdByMemberId, v.submittedByMemberId, v.decidedByMemberId]),
    ...visible.map((row) => row.assignedByMemberId),
  ]);
  const person = (memberId: string | null) => (memberId ? (people.get(memberId) ?? null) : null);
  const activeCount = rows.filter((row) => row.status === 'active').length;
  return ok({
    ...card(skill, versions, activeCount),
    archived: skill.archivedAt !== null,
    draftRevision: summary.draft?.revision ?? null,
    focusNumber: (summary.pending ?? summary.current ?? summary.draft ?? summary.latest).number,
    versions: versions.map((v) => ({
      number: v.number,
      status: v.status,
      changeNote: v.changeNote,
      risk: v.risk,
      proposedRisk: v.proposedRisk,
      suggestedRisk: v.suggestedRisk,
      hasScripts: v.hasScripts,
      everApproved: v.everApproved,
      createdBy: person(v.createdByMemberId),
      createdAt: v.createdAt.toISOString(),
      submittedBy: person(v.submittedByMemberId),
      submittedAt: iso(v.submittedAt),
      decidedBy: person(v.decidedByMemberId),
      decidedAt: iso(v.decidedAt),
      rejectReason: v.rejectReason,
    })),
    holders: visible.map((row) => ({
      workerId: row.workerId,
      workerName: row.workerName,
      workerStatus: row.workerStatus,
      departmentId: row.departmentId,
      status: row.status,
      assignedBy: person(row.assignedByMemberId),
      requestedAt: row.requestedAt.toISOString(),
    })),
    holderCount: rows.length,
  });
}

export type VersionView = {
  readonly number: number;
  readonly status: SkillVersionStatus;
  readonly title: string;
  readonly description: string;
  readonly hasScripts: boolean;
  readonly suggestedRisk: RiskLevel;
  readonly proposedRisk: RiskLevel | null;
  readonly risk: RiskLevel | null;
  readonly changeNote: string | null;
  readonly revision: number;
  readonly isCurrent: boolean;
  /** The version in use when this is another one ("so với v2"). */
  readonly comparedTo: number | null;
  readonly skillMd: string;
  readonly files: readonly { path: string; size: number; mediaType: string }[];
};

/** GET /api/skills/:id/versions/:n. */
export async function versionView(
  tx: CompanyTx,
  id: string,
  number: number,
): Promise<Outcome<VersionView>> {
  const skill = await loadSkill(tx, id);
  if (!skill) return notFound;
  const version = await loadVersion(tx, id, number);
  if (!version) return notFound;
  const current = skill.currentVersionId
    ? (await loadVersions(tx, id)).find((v) => v.id === skill.currentVersionId)
    : undefined;
  const files = await versionFiles(tx, version.id);
  return ok({
    number: version.number,
    status: version.status,
    title: version.title,
    description: version.description,
    hasScripts: version.hasScripts,
    suggestedRisk: version.suggestedRisk,
    proposedRisk: version.proposedRisk,
    risk: version.risk,
    changeNote: version.changeNote,
    revision: version.revision,
    isCurrent: version.id === skill.currentVersionId,
    comparedTo: current && current.id !== version.id ? current.number : null,
    skillMd: await readSkillMd(tx, version.id),
    files: files.map((file) => ({ path: file.path, size: file.size, mediaType: file.mediaType })),
  });
}
