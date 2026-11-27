import type { z } from 'zod';
import { ConfigError } from './config-error.ts';
import { type Env, loadConfig } from './load-config.ts';

/** For process entry points: print config issues to stderr and exit(1). */
export function loadConfigOrExit<S extends z.ZodType>(
  schema: S,
  env: Env = process.env,
): Readonly<z.output<S>> {
  try {
    return loadConfig(schema, env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}
