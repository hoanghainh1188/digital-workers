import { envFields } from '@dw/core';
import { z } from 'zod';

const positiveInt = (fallback: number, max: number) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? String(fallback) : value),
    z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(max)),
  );

/** `provider:model`, e.g. `anthropic:claude-sonnet-5-5` (0.2 #131). */
const workerModel = z
  .string()
  .default('anthropic:claude-sonnet-5-5')
  .pipe(z.string().regex(/^(anthropic|openai):[A-Za-z0-9._-]{1,100}$/))
  .transform((value) => {
    const [provider, id] = value.split(':') as ['anthropic' | 'openai', string];
    return { provider, id } as const;
  });

/**
 * Environment variables used by the runner (change add-worker-runtime-webchat, task 1.3).
 * Limits are per Task and shared by every worker in the MVP (0.2 #123).
 */
export const runnerConfigSchema = z.object({
  LOG_LEVEL: envFields.logLevel,
  NODE_ENV: envFields.nodeEnv,
  DATABASE_URL: envFields.databaseUrl,
  /** Opens the platform's provider keys (spec secret-encryption). */
  ENCRYPTION_KEY: envFields.encryptionKey,
  /** "Hết ngân sách" email to the worker's manager (0.2 #129). */
  SMTP_URL: z.url({ protocol: /^smtps?$/ }),
  MAIL_FROM: z.string().min(3),
  WEB_ORIGIN: z.url({ protocol: /^https?$/ }).default('http://localhost:5173'),
  WORKER_MODEL: workerModel,
  RUNNER_CONCURRENCY: positiveInt(4, 64),
  TASK_MAX_STEPS: positiveInt(12, 100),
  TASK_MAX_SECONDS: positiveInt(180, 3600),
  TASK_MAX_CHARGE_VND: positiveInt(8000, 10_000_000),
  /** /health/ready for the container healthcheck. */
  HEALTH_PORT: envFields.port(3001),
});

export type RunnerConfig = z.output<typeof runnerConfigSchema>;
