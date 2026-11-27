import { envFields } from '@dw/core';
import { z } from 'zod';

/**
 * Environment variables used by the runner. The queue (pg-boss) and therefore
 * DATABASE_URL arrive with change `add-worker-runtime-webchat`.
 */
export const runnerConfigSchema = z.object({
  LOG_LEVEL: envFields.logLevel,
  NODE_ENV: envFields.nodeEnv,
});

export type RunnerConfig = z.output<typeof runnerConfigSchema>;
