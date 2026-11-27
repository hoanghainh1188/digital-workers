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

/** Reusable environment field schemas shared by every process. */
export const envFields = {
  databaseUrl: z.url({ protocol: /^postgres(ql)?$/ }),
  port,
  host: z.string().min(1),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
} as const;
