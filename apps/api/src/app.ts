import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { type Auth, type FailedLoginLimiter, registerAuthRoutes } from './auth/index.ts';
import { registerErrorHandling } from './plugins/errors.ts';
import { zodSerializerCompiler, zodValidatorCompiler } from './plugins/zod.ts';
import { type HealthDeps, registerHealthRoutes } from './routes/health.ts';
import { registerTenancyRoutes, type TenancyRouteDeps } from './routes/tenancy.ts';
import { type ContextResolver, registerRequestContext } from './tenancy/index.ts';

/** Everything behind sign-in. Optional so health-only tests can build a bare app. */
export type PlatformDeps = TenancyRouteDeps & {
  readonly auth: Auth;
  readonly limiter: FailedLoginLimiter;
  readonly resolveContext: ContextResolver;
};

export type AppDeps = HealthDeps & {
  readonly logger: FastifyBaseLogger;
  /** Behind Caddy: trust X-Forwarded-* for the client IP and protocol (design D5). */
  readonly trustProxy?: boolean;
  readonly platform?: PlatformDeps;
};

/** Builds the API without listening, so tests can use `app.inject()`. */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ loggerInstance: deps.logger, trustProxy: deps.trustProxy ?? false });
  app.setValidatorCompiler(zodValidatorCompiler);
  app.setSerializerCompiler(zodSerializerCompiler);
  registerErrorHandling(app);
  registerHealthRoutes(app, deps);
  if (deps.platform) {
    registerRequestContext(app, deps.platform.resolveContext);
    registerAuthRoutes(app, deps.platform);
    registerTenancyRoutes(app, deps.platform);
  }
  return app;
}
