import { describeError } from '@dw/core';
import { ping } from '@dw/db';
import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';

export const READY_TIMEOUT_MS = 2_000;

/** Database check for /health/ready. Failures are logged as message + code only. */
export function databaseReadiness(
  pool: pg.Pool,
  logger: FastifyBaseLogger,
): () => Promise<boolean> {
  return () =>
    ping(pool, READY_TIMEOUT_MS, (error) =>
      logger.warn({ error: describeError(error) }, 'database ping failed'),
    );
}
