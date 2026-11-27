import { envFields } from '@dw/core';
import { z } from 'zod';

/** Environment variables used by the API process (and only those). */
export const apiConfigSchema = z.object({
  DATABASE_URL: envFields.databaseUrl,
  PORT: envFields.port(3000),
  HOST: envFields.host.default('0.0.0.0'),
  LOG_LEVEL: envFields.logLevel,
  NODE_ENV: envFields.nodeEnv,
});

export type ApiConfig = z.output<typeof apiConfigSchema>;
