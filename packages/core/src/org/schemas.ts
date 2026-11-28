import { z } from 'zod';
import { ROLES } from '../access/permissions.ts';
import { emailSchema, FIELD_ERRORS, passwordSchema } from '../auth/schemas.ts';

/**
 * Input schemas for departments, invitations, members and password reset
 * (change add-departments-and-invites). Messages are stable codes, like auth/schemas.ts.
 */
export const ORG_FIELD_ERRORS = {
  departmentRequired: 'department_required',
  departmentNotFound: 'department_not_found',
  tooMany: 'too_many',
  managerSingle: 'manager_single',
} as const;

export const MAX_INVITES_PER_REQUEST = 50;

const roleSchema = z.enum(ROLES, { error: FIELD_ERRORS.required });

const requiredText = (max: number) =>
  z
    .string({ error: FIELD_ERRORS.required })
    .trim()
    .min(1, { error: FIELD_ERRORS.required })
    .max(max, { error: FIELD_ERRORS.tooLong });

/** Optional free text: blank becomes null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: FIELD_ERRORS.tooLong })
    .transform((value) => (value === '' ? null : value))
    .nullish()
    .transform((value) => value ?? null);

const idSchema = z.uuid({ error: FIELD_ERRORS.required });

export const departmentNameSchema = requiredText(80);

/** POST /api/departments. */
export const departmentInput = z.strictObject({
  name: departmentNameSchema,
  description: optionalText(300),
  headMemberId: idSchema.nullish().transform((value) => value ?? null),
});
export type DepartmentInput = z.output<typeof departmentInput>;

/** PATCH /api/departments/:id — at least one field; `headMemberId: null` removes the head. */
export const departmentPatchInput = z
  .strictObject({
    name: departmentNameSchema.optional(),
    description: optionalText(300).optional(),
    headMemberId: idSchema.nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    error: FIELD_ERRORS.required,
  });
export type DepartmentPatchInput = z.output<typeof departmentPatchInput>;

/**
 * Splits pasted text into addresses: commas, semicolons, spaces or new lines.
 * Duplicates (case-insensitive) are kept once, in first-seen order.
 */
export function splitEmailList(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(/[\s,;]+/)) {
    const email = part.trim();
    const key = email.toLowerCase();
    if (email === '' || seen.has(key)) continue;
    seen.add(key);
    result.push(email);
  }
  return result;
}

/** Addresses from `emails` that are not valid email addresses (as typed). */
export function invalidEmails(emails: readonly string[]): string[] {
  return emails.filter((email) => !emailSchema.safeParse(email).success);
}

/** POST /api/invitations: up to 50 emails with one role and department. */
export const invitationInput = z
  .strictObject({
    emails: z
      .array(emailSchema, { error: FIELD_ERRORS.required })
      .min(1, { error: FIELD_ERRORS.required })
      .max(MAX_INVITES_PER_REQUEST, { error: ORG_FIELD_ERRORS.tooMany }),
    role: roleSchema,
    departmentId: idSchema.nullish().transform((value) => value ?? null),
  })
  .transform((value) => ({ ...value, emails: [...new Set(value.emails)] }))
  .superRefine((value, ctx) => {
    if ((value.role === 'manager' || value.role === 'member') && value.departmentId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['departmentId'],
        message: ORG_FIELD_ERRORS.departmentRequired,
      });
    }
    // A department has at most one Manager, so a Manager invite names one person.
    if (value.role === 'manager' && value.emails.length > 1) {
      ctx.addIssue({ code: 'custom', path: ['emails'], message: ORG_FIELD_ERRORS.managerSingle });
    }
  });
export type InvitationInput = z.output<typeof invitationInput>;

/** PATCH /api/members/:id — change role and / or department. */
export const memberPatchInput = z
  .strictObject({
    role: roleSchema.optional(),
    departmentId: idSchema.nullable().optional(),
  })
  .refine((value) => value.role !== undefined || value.departmentId !== undefined, {
    error: FIELD_ERRORS.required,
  });
export type MemberPatchInput = z.output<typeof memberPatchInput>;

const tokenSchema = z
  .string({ error: FIELD_ERRORS.required })
  .min(1, { error: FIELD_ERRORS.required })
  .max(200, { error: FIELD_ERRORS.tooLong });

/** POST /api/invitations/preview. */
export const invitationTokenInput = z.strictObject({ token: tokenSchema });

/**
 * POST /api/invitations/accept. Name + password create a new account; without
 * them the caller must already be signed in with the invited email (design D4).
 */
export const acceptInvitationInput = z
  .strictObject({
    token: tokenSchema,
    name: requiredText(100).optional(),
    password: passwordSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.name === undefined) !== (value.password === undefined)) {
      const missing = value.name === undefined ? 'name' : 'password';
      ctx.addIssue({ code: 'custom', path: [missing], message: FIELD_ERRORS.required });
    }
  });
export type AcceptInvitationInput = z.output<typeof acceptInvitationInput>;

/** Forgot password form (body of POST /api/auth/request-password-reset). */
export const forgotPasswordInput = z.strictObject({ email: emailSchema });

/** Reset password form (body of POST /api/auth/reset-password). */
export const resetPasswordInput = z.strictObject({
  token: tokenSchema,
  newPassword: passwordSchema,
});
