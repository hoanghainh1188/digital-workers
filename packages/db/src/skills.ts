import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { skills, skillVersions, workerSkills } from './schema/skills.ts';
import { workers } from './schema/workers.ts';
import { type CompanyTx, recordAudit } from './tenancy.ts';

/**
 * Audit target of an assignment: both ids in one `target_id` ("<workerId>:<skillId>"),
 * so the event names the worker and the skill even after the row is deleted (D12).
 */
export function workerSkillTarget(
  workerId: string,
  skillId: string,
): { readonly targetType: 'worker_skill'; readonly targetId: string } {
  return { targetType: 'worker_skill', targetId: `${workerId}:${skillId}` };
}

/** A skill a worker may use right now, at the version in use (design D8, FR-04-02). */
export interface EffectiveSkill {
  readonly skillId: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly versionId: string;
  readonly number: number;
}

/**
 * Skills in effect for `workerId`: only `active` assignments of skills that are not
 * archived, at `current_version_id` — never a pending or draft version. Change 5 loads
 * skills through this function only.
 */
export async function effectiveSkills(tx: CompanyTx, workerId: string): Promise<EffectiveSkill[]> {
  return tx
    .select({
      skillId: skills.id,
      name: skills.name,
      title: skillVersions.title,
      description: skillVersions.description,
      versionId: skillVersions.id,
      number: skillVersions.number,
    })
    .from(workerSkills)
    .innerJoin(skills, eq(skills.id, workerSkills.skillId))
    .innerJoin(skillVersions, eq(skillVersions.id, skills.currentVersionId))
    .where(
      and(
        eq(workerSkills.workerId, workerId),
        eq(workerSkills.status, 'active'),
        isNull(skills.archivedAt),
        isNotNull(skills.currentVersionId),
      ),
    )
    .orderBy(asc(skills.name));
}

/**
 * Workers (not offboarded) holding `skillId` in any state — active, pending or suspended.
 * A skill can be archived only when this is empty (0.2 #060).
 */
export async function workersHoldingSkill(tx: CompanyTx, skillId: string): Promise<string[]> {
  const rows = await tx
    .select({ workerId: workerSkills.workerId })
    .from(workerSkills)
    .innerJoin(workers, eq(workers.id, workerSkills.workerId))
    .where(and(eq(workerSkills.skillId, skillId), ne(workers.status, 'offboarded')))
    .orderBy(asc(workers.name));
  return rows.map((row) => row.workerId);
}

/**
 * Runs in the transaction that makes a probation worker active (design D8, 0.2 #088):
 * its script skills stop being in effect (`suspended`) until review exists (change 11).
 */
export async function suspendScriptSkillsOnActivation(
  tx: CompanyTx,
  workerId: string,
  actorMemberId: string | null,
): Promise<void> {
  const scriptSkills = tx
    .select({ id: skills.id })
    .from(skills)
    .innerJoin(skillVersions, eq(skillVersions.id, skills.currentVersionId))
    .where(eq(skillVersions.hasScripts, true));
  const suspended = await tx
    .update(workerSkills)
    .set({ status: 'suspended', decidedByMemberId: null, decidedAt: sql`now()` })
    .where(
      and(
        eq(workerSkills.workerId, workerId),
        inArray(workerSkills.status, ['active', 'pending']),
        inArray(workerSkills.skillId, scriptSkills),
      ),
    )
    .returning({ skillId: workerSkills.skillId });
  for (const row of suspended) {
    await recordAudit(tx, {
      actorMemberId,
      action: 'worker_skill.suspended',
      ...workerSkillTarget(workerId, row.skillId),
      fields: ['status'],
    });
  }
}
