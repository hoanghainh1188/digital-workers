import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { registerErrorHandling } from './plugins/errors.ts';
import { zodSerializerCompiler, zodValidatorCompiler } from './plugins/zod.ts';
import { type HealthDeps, registerHealthRoutes } from './routes/health.ts';

export type AppDeps = HealthDeps & {
  readonly logger: FastifyBaseLogger;
};

/** Builds the API without listening, so tests can use `app.inject()`. */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ loggerInstance: deps.logger });
  app.setValidatorCompiler(zodValidatorCompiler);
  app.setSerializerCompiler(zodSerializerCompiler);
  registerErrorHandling(app);
  registerHealthRoutes(app, deps);
  return app;
}
