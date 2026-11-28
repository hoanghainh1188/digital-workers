import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { type Auth, registerAuthRoutes } from './auth/index.ts';
import { registerErrorHandling } from './plugins/errors.ts';
import { registerOriginCheck } from './plugins/request-guards.ts';
import { zodSerializerCompiler, zodValidatorCompiler } from './plugins/zod.ts';
import { registerDepartmentRoutes } from './routes/departments.ts';
import { type HealthDeps, registerHealthRoutes } from './routes/health.ts';
import { type InvitationRouteDeps, registerInvitationRoutes } from './routes/invitations.ts';
import { registerMemberRoutes } from './routes/members.ts';
import { registerSkillRoutes } from './routes/skills.ts';
import { registerTenancyRoutes, type TenancyRouteDeps } from './routes/tenancy.ts';
import { registerWorkerRoutes } from './routes/workers.ts';
import { type ContextResolver, registerRequestContext } from './tenancy/index.ts';

/** Everything behind sign-in. Optional so health-only tests can build a bare app. */
export type PlatformDeps = TenancyRouteDeps &
  InvitationRouteDeps & {
    readonly auth: Auth;
    readonly resolveContext: ContextResolver;
    /** Origins allowed to send state-changing requests (CSRF). */
    readonly trustedOrigins: readonly string[];
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
    registerOriginCheck(app, deps.platform.trustedOrigins);
    registerRequestContext(app, deps.platform.resolveContext);
    registerAuthRoutes(app, deps.platform);
    registerTenancyRoutes(app, deps.platform);
    registerDepartmentRoutes(app, deps.platform);
    registerMemberRoutes(app, deps.platform);
    registerInvitationRoutes(app, deps.platform);
    registerWorkerRoutes(app, deps.platform);
    registerSkillRoutes(app, deps.platform);
  }
  return app;
}
