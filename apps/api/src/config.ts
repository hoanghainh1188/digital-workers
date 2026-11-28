import { envFields } from '@dw/core';
import { z } from 'zod';

const optionalText = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional(),
);
/** Comma-separated emails, compared lower-case. Empty = nobody is a platform admin. */
const emailList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )
  .pipe(z.array(z.email()));
const booleanFlag = z
  .enum(['true', 'false', '1', '0', ''])
  .default('false')
  .transform((value) => value === 'true' || value === '1');

/** Environment variables used by the API process (and only those). Design D10. */
export const apiConfigSchema = z
  .object({
    DATABASE_URL: envFields.databaseUrl,
    PORT: envFields.port(3000),
    HOST: envFields.host.default('0.0.0.0'),
    LOG_LEVEL: envFields.logLevel,
    NODE_ENV: envFields.nodeEnv,
    BETTER_AUTH_SECRET: z.string().min(32),
    /** Public origin of the app (the browser sees /api/auth under it). */
    BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }),
    WEB_ORIGIN: z.url({ protocol: /^https?$/ }).default('http://localhost:5173'),
    SMTP_URL: z.url({ protocol: /^smtps?$/ }),
    MAIL_FROM: z.string().min(3),
    GOOGLE_CLIENT_ID: optionalText,
    GOOGLE_CLIENT_SECRET: optionalText,
    /** True behind Caddy: take the client IP from X-Forwarded-For. */
    TRUST_PROXY: booleanFlag,
    /** Master key for stored secrets (spec secret-encryption): 32 bytes, base64. */
    ENCRYPTION_KEY: envFields.encryptionKey,
    /** Platform admins (design D10, 0.2 #076): not members of any company, TOTP required. */
    PLATFORM_ADMIN_EMAILS: emailList,
  })
  .superRefine((config, ctx) => {
    // Google needs both values or neither (design D10).
    const hasId = Boolean(config.GOOGLE_CLIENT_ID);
    const hasSecret = Boolean(config.GOOGLE_CLIENT_SECRET);
    if (hasId !== hasSecret) {
      ctx.addIssue({
        code: 'custom',
        path: [hasId ? 'GOOGLE_CLIENT_SECRET' : 'GOOGLE_CLIENT_ID'],
        message: 'set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither',
      });
    }
  });

export type ApiConfig = z.output<typeof apiConfigSchema>;

export function googleCredentials(
  config: Pick<ApiConfig, 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'>,
) {
  return config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
    ? { clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET }
    : null;
}
