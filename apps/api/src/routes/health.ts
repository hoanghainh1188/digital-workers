import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from '../plugins/zod.ts';

export type HealthDeps = {
  /** Resolves true when the database answered within its timeout. Must not throw. */
  readonly checkDatabase: () => Promise<boolean>;
};

const live = z.strictObject({ status: z.literal('ok') });
const ready = z.strictObject({ status: z.literal('ready') });
const unavailable = z.strictObject({ status: z.literal('unavailable') });

/** Public, unauthenticated health checks (spec: service-health). Bodies carry `status` only. */
export function registerHealthRoutes(app: FastifyInstance, deps: HealthDeps): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get('/health', { schema: { response: { 200: live } } }, async () => ({
    status: 'ok' as const,
  }));

  routes.get(
    '/health/ready',
    { schema: { response: { 200: ready, 503: unavailable } } },
    async (_request, reply) => {
      if (await deps.checkDatabase()) {
        return reply.status(200).send({ status: 'ready' });
      }
      return reply.status(503).send({ status: 'unavailable' });
    },
  );
}
