import { z } from 'zod';
import { isCommonPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password.ts';

/**
 * Input schemas shared by api and web. Messages are stable codes, not text:
 * the web maps them to Vietnamese (i18n), the API returns them in error details.
 */
export const FIELD_ERRORS = {
  required: 'required',
  tooLong: 'too_long',
  emailInvalid: 'email_invalid',
  passwordTooShort: 'password_too_short',
  passwordTooLong: 'password_too_long',
  passwordCommon: 'password_common',
  phoneInvalid: 'phone_invalid',
} as const;
export type FieldErrorCode = (typeof FIELD_ERRORS)[keyof typeof FIELD_ERRORS];

const requiredText = (max: number) =>
  z
    .string({ error: FIELD_ERRORS.required })
    .trim()
    .min(1, { error: FIELD_ERRORS.required })
    .max(max, { error: FIELD_ERRORS.tooLong });

export const passwordSchema = z
  .string({ error: FIELD_ERRORS.required })
  .min(1, { error: FIELD_ERRORS.required, abort: true })
  .min(PASSWORD_MIN_LENGTH, { error: FIELD_ERRORS.passwordTooShort, abort: true })
  .max(PASSWORD_MAX_LENGTH, { error: FIELD_ERRORS.passwordTooLong, abort: true })
  .refine((value) => !isCommonPassword(value), { error: FIELD_ERRORS.passwordCommon });

export const emailSchema = z
  .string({ error: FIELD_ERRORS.required })
  .trim()
  .toLowerCase()
  .min(1, { error: FIELD_ERRORS.required })
  .max(254, { error: FIELD_ERRORS.tooLong })
  .pipe(z.email({ error: FIELD_ERRORS.emailInvalid }));

/** Optional Vietnamese-style phone: digits, spaces, dots, dashes, optional leading +. Blank = none. */
export const phoneSchema = z
  .string()
  .trim()
  .max(20, { error: FIELD_ERRORS.tooLong })
  .regex(/^(\+?\d[\d .-]{7,18}\d)?$/, { error: FIELD_ERRORS.phoneInvalid })
  .transform((value) => (value === '' ? null : value))
  .nullish()
  .transform((value) => value ?? null);

export const companyNameSchema = requiredText(120);

/** POST /api/signup (spec company-signup). */
export const signupInput = z.strictObject({
  companyName: companyNameSchema,
  name: requiredText(100),
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema.optional(),
});
export type SignupInput = z.output<typeof signupInput>;

/** POST /api/companies (create after Google sign-in). */
export const companyInput = z.strictObject({
  name: companyNameSchema,
  contactPhone: phoneSchema.optional(),
});
export type CompanyInput = z.output<typeof companyInput>;

/** PATCH /api/company: at least one field. */
export const companyPatchInput = z
  .strictObject({
    name: companyNameSchema.optional(),
    contactPhone: phoneSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.contactPhone !== undefined, {
    error: FIELD_ERRORS.required,
  });
export type CompanyPatchInput = z.output<typeof companyPatchInput>;

/** POST /api/auth/sign-in/email body as the web sends it. */
export const signinInput = z.object({
  email: emailSchema,
  password: z.string({ error: FIELD_ERRORS.required }).min(1, { error: FIELD_ERRORS.required }),
});
