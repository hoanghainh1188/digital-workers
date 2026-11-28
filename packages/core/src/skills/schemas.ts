import { z } from 'zod';
import { FIELD_ERRORS } from '../auth/schemas.ts';
import { RISK_LEVELS } from './assignment-rules.ts';

/** Input schemas for /api/skills* and /api/workers/:id/skills* (design D9). */

export const SKILL_VERSION_STATUSES = [
  'draft',
  'pending',
  'approved',
  'rejected',
  'superseded',
] as const;
export type SkillVersionStatus = (typeof SKILL_VERSION_STATUSES)[number];

/** List status of a whole skill (spec skill-library "Xem thư viện kỹ năng"). */
export const SKILL_STATUSES = ['draft', 'pending', 'active', 'archived'] as const;
export type SkillStatus = (typeof SKILL_STATUSES)[number];

/** Rough upper bound on the text; the byte limit (200 KiB, #089) is checked by @dw/skills. */
export const SKILL_MD_MAX_CHARS = 204_800;
export const CHANGE_NOTE_MAX = 500;
export const REJECT_REASON_MAX = 500;
export const SKILL_QUERY_MAX = 100;

const skillMd = z
  .string({ error: FIELD_ERRORS.required })
  .min(1, { error: FIELD_ERRORS.required })
  .max(SKILL_MD_MAX_CHARS, { error: FIELD_ERRORS.tooLong });

const riskSchema = z.enum(RISK_LEVELS, { error: FIELD_ERRORS.required });

/** POST /api/skills. */
export const createSkillInput = z.strictObject({ skillMd });
export type CreateSkillInput = z.output<typeof createSkillInput>;

/** PUT /api/skills/:id/draft — `revision` of the draft the edit started from (null = none). */
export const saveDraftInput = z.strictObject({
  skillMd,
  revision: z.number().int().min(0).nullable(),
});
export type SaveDraftInput = z.output<typeof saveDraftInput>;

/** POST /api/skills/:id/draft/submit. */
export const submitDraftInput = z.strictObject({
  revision: z.number().int().min(0),
  changeNote: z
    .string()
    .trim()
    .max(CHANGE_NOTE_MAX, { error: FIELD_ERRORS.tooLong })
    .nullish()
    .transform((value) => (value ? value : null)),
  proposedRisk: riskSchema,
});
export type SubmitDraftInput = z.output<typeof submitDraftInput>;

/** POST /api/skills/:id/versions/:n/approve. */
export const approveVersionInput = z.strictObject({ risk: riskSchema });

/** POST /api/skills/:id/versions/:n/reject — reason required (0.2 #091). */
export const rejectVersionInput = z.strictObject({
  reason: z
    .string({ error: FIELD_ERRORS.required })
    .trim()
    .min(1, { error: FIELD_ERRORS.required })
    .max(REJECT_REASON_MAX, { error: FIELD_ERRORS.tooLong }),
});

/** POST /api/skills/:id/rollback. */
export const rollbackInput = z.strictObject({
  versionNumber: z.number({ error: FIELD_ERRORS.required }).int().min(1),
});

/** POST /api/workers/:id/skills. */
export const assignSkillInput = z.strictObject({
  skillId: z.uuid({ error: FIELD_ERRORS.required }),
});

/** GET /api/skills?q=&status=&risk=&archived=. */
export const skillListQuery = z.object({
  q: z.string().trim().max(SKILL_QUERY_MAX).optional(),
  status: z.enum(SKILL_STATUSES).optional(),
  risk: z.enum(RISK_LEVELS).optional(),
  archived: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
export type SkillListQuery = z.output<typeof skillListQuery>;

/** Path params. */
export const versionNumberParam = z.coerce.number().int().min(1).max(100_000);
