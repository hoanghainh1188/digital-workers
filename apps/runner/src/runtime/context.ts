import type { SkillSummary, VoicePreset, WorkerProfileForPrompt } from '@dw/core';
import {
  type ChatMessage,
  type CompanyTx,
  companies,
  conversationHistory,
  departments,
  type EffectiveSkill,
  effectiveSkills,
  type TaskRow,
  taskUserMessages,
  workers,
} from '@dw/db';
import { eq } from '@dw/db/drizzle';

/** Messages of history given to the model (0.2 #126). */
export const HISTORY_LIMIT = 30;

export interface TaskContext {
  readonly profile: WorkerProfileForPrompt;
  readonly skills: readonly EffectiveSkill[];
  readonly summaries: readonly SkillSummary[];
  readonly history: readonly ChatMessage[];
  readonly taskMessages: readonly ChatMessage[];
}

/**
 * Everything one Task needs, read inside its company (design D8): RLS makes another
 * company's profile, skills or messages unreachable from here.
 */
export async function loadTaskContext(tx: CompanyTx, task: TaskRow): Promise<TaskContext | null> {
  const [row] = await tx
    .select({
      workerName: workers.name,
      status: workers.status,
      jobDescription: workers.jobDescription,
      voicePreset: workers.voicePreset,
      voiceCustom: workers.voiceCustom,
      departmentName: departments.name,
      companyName: companies.name,
    })
    .from(workers)
    .innerJoin(departments, eq(departments.id, workers.departmentId))
    .innerJoin(companies, eq(companies.id, workers.companyId))
    .where(eq(workers.id, task.workerId));
  if (!row) return null;
  const skills = await effectiveSkills(tx, task.workerId);
  const taskMessages = await taskUserMessages(tx, task.id);
  const firstSeq = taskMessages[0]?.seq ?? Number.MAX_SAFE_INTEGER;
  const history = task.conversationId
    ? await conversationHistory(tx, task.conversationId, firstSeq, HISTORY_LIMIT)
    : [];
  return {
    profile: {
      workerName: row.workerName,
      companyName: row.companyName,
      departmentName: row.departmentName,
      jobDescription: row.jobDescription,
      voicePreset: (row.voicePreset as VoicePreset | null) ?? null,
      voiceCustom: row.voiceCustom,
      status: row.status,
    },
    skills,
    summaries: skills.map((skill) => ({ name: skill.name, description: skill.description })),
    history,
    taskMessages,
  };
}
