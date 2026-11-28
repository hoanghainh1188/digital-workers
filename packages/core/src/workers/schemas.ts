import { z } from 'zod';
import { FIELD_ERRORS } from '../auth/schemas.ts';
import { STATUS_EVENTS, WORKER_STATUSES } from './lifecycle.ts';
import { MAX_WORKER_BUDGET_VND, PROBATION_EXTENSIONS } from './rules.ts';

/** Input schemas for /api/workers* (design D3, D4). Messages are stable codes. */

export const WORKER_FIELD_ERRORS = {
  budgetInteger: 'budget_integer',
  budgetRange: 'budget_range',
  tooMany: 'too_many',
  daysInvalid: 'days_invalid',
} as const;

export const WORKER_NAME_MAX = 60;
export const JOB_DESCRIPTION_MAX = 4_000;
export const VOICE_CUSTOM_MAX = 500;
export const REASON_MAX = 500;
export const MAX_TESTERS = 10;

/** Preset voices (FR-02-01); labels live in the web i18n file. */
export const VOICE_PRESETS = ['polite', 'friendly', 'formal'] as const;
export type VoicePreset = (typeof VOICE_PRESETS)[number];

const idSchema = z.uuid({ error: FIELD_ERRORS.required });

export const workerNameSchema = z
  .string({ error: FIELD_ERRORS.required })
  .trim()
  .min(1, { error: FIELD_ERRORS.required })
  .max(WORKER_NAME_MAX, { error: FIELD_ERRORS.tooLong });

const jobDescriptionSchema = z
  .string({ error: FIELD_ERRORS.required })
  .max(JOB_DESCRIPTION_MAX, { error: FIELD_ERRORS.tooLong });

/** Optional text up to `max`; blank becomes null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: FIELD_ERRORS.tooLong })
    .transform((value) => (value === '' ? null : value))
    .nullish()
    .transform((value) => value ?? null);

export const budgetSchema = z
  .number({ error: FIELD_ERRORS.required })
  .int({ error: WORKER_FIELD_ERRORS.budgetInteger })
  .min(0, { error: WORKER_FIELD_ERRORS.budgetRange })
  .max(MAX_WORKER_BUDGET_VND, { error: WORKER_FIELD_ERRORS.budgetRange });

const voicePresetSchema = z.enum(VOICE_PRESETS, { error: FIELD_ERRORS.required }).nullable();

/** POST /api/workers — from a template or blank; always a draft (FR-02-07). */
export const workerInput = z.strictObject({
  templateId: z
    .string()
    .max(60)
    .nullish()
    .transform((value) => value ?? null),
  name: workerNameSchema,
  departmentId: idSchema,
});
export type WorkerInput = z.output<typeof workerInput>;

/** PATCH /api/workers/:id — `revision` guards against overwriting someone else's save. */
export const workerPatchInput = z
  .strictObject({
    revision: z.number().int().min(0),
    name: workerNameSchema.optional(),
    jobDescription: jobDescriptionSchema.optional(),
    voicePreset: voicePresetSchema.optional(),
    voiceCustom: optionalText(VOICE_CUSTOM_MAX).optional(),
    monthlyBudgetVnd: budgetSchema.optional(),
    managerMemberId: idSchema.nullable().optional(),
  })
  .refine(
    ({ revision: _revision, ...fields }) => Object.values(fields).some((v) => v !== undefined),
    {
      error: FIELD_ERRORS.required,
    },
  );
export type WorkerPatchInput = z.output<typeof workerPatchInput>;

/** POST /api/workers/:id/transitions. */
export const transitionInput = z.strictObject({
  event: z.enum(STATUS_EVENTS, { error: FIELD_ERRORS.required }),
  expectedStatus: z.enum(WORKER_STATUSES, { error: FIELD_ERRORS.required }),
  reason: optionalText(REASON_MAX),
  confirmName: z
    .string()
    .max(200)
    .nullish()
    .transform((value) => value ?? null),
});
export type TransitionRequest = z.output<typeof transitionInput>;

/** POST /api/workers/:id/probation/extend (#107). */
export const extendProbationInput = z.strictObject({
  days: z
    .number({ error: FIELD_ERRORS.required })
    .refine((days) => (PROBATION_EXTENSIONS as readonly number[]).includes(days), {
      error: WORKER_FIELD_ERRORS.daysInvalid,
    })
    .transform((days) => days as (typeof PROBATION_EXTENSIONS)[number]),
});

/** POST /api/workers/:id/promotion-request. */
export const promotionRequestInput = z.strictObject({ note: optionalText(REASON_MAX) });

/** POST /api/workers/:id/promotion-request/return — reason required (#054). */
export const returnProposalInput = z.strictObject({
  reason: z
    .string({ error: FIELD_ERRORS.required })
    .trim()
    .min(1, { error: FIELD_ERRORS.required })
    .max(REASON_MAX, { error: FIELD_ERRORS.tooLong }),
});

/** PUT /api/workers/:id/testers. */
export const testersInput = z.strictObject({
  memberIds: z
    .array(idSchema)
    .max(MAX_TESTERS, { error: WORKER_FIELD_ERRORS.tooMany })
    .transform((ids) => [...new Set(ids)]),
});

/** POST /api/workers/:id/department — Owner / Admin only (#052). */
export const workerDepartmentInput = z.strictObject({
  departmentId: idSchema,
  managerMemberId: idSchema.nullish(),
});

/** GET /api/workers?status=. */
export const workerListQuery = z.object({
  status: z.enum(WORKER_STATUSES).optional(),
});
