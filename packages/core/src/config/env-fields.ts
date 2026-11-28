import { z } from 'zod';

const portNumber = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(65_535));

/**
 * TCP port: digits only (no '0x10', '1e3', ' 80'), 1–65535. A blank value counts
 * as unset, so `PORT=` in an env file falls back to `fallback` instead of port 0.
 */
function port(fallback: number) {
  return z.preprocess(
    (value) => (value === undefined || value === '' ? String(fallback) : value),
    portNumber,
  );
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Master key for secrets (spec secret-encryption): base64 of exactly 32 bytes.
 * Produces the decoded bytes. Failures carry only a reason, never the value.
 */
const encryptionKey = z
  .string()
  .trim()
  .min(1)
  .refine((value) => BASE64.test(value) && Buffer.from(value, 'base64').length === 32, {
    message: 'must be 32 bytes, base64-encoded',
  })
  .transform((value) => Buffer.from(value, 'base64'));

/** Reusable environment field schemas shared by every process. */
export const envFields = {
  encryptionKey,
  databaseUrl: z.url({ protocol: /^postgres(ql)?$/ }),
  port,
  host: z.string().min(1),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
} as const;
