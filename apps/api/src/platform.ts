import { type Database, memberForUser, recordAudit, withCompany } from '@dw/db';
import type { Mailer } from '@dw/mail';
import type { FastifyBaseLogger } from 'fastify';
import type { PlatformDeps } from './app.ts';
import {
  type AuthDeps,
  createAuth,
  createFailedLoginLimiter,
  type FailedLoginLimiter,
  readSessionUser,
} from './auth/index.ts';
import { googleCredentials } from './config.ts';
import type { RequestLimit } from './plugins/request-guards.ts';
import { type AuditWriter, companyCreator, createGuards } from './tenancy/index.ts';

export type PlatformOptions = {
  readonly config: AuthDeps['config'];
  readonly database: Database;
  readonly mailer: Mailer;
  readonly logger: FastifyBaseLogger;
  readonly ipRateLimit?: boolean;
  readonly limiter?: FailedLoginLimiter;
  readonly createCompany?: PlatformDeps['createCompany'];
  /** Per-IP limit on POST /api/signup and /api/companies. Default: 10 per minute. */
  readonly signupLimit?: RequestLimit;
};

/** Wires auth, request context, guards and services for `buildApp` (main and tests). */
export function createPlatform(options: PlatformOptions): PlatformDeps {
  const { database, config } = options;
  const limiter = options.limiter ?? createFailedLoginLimiter();
  const auth = createAuth({ ...options, limiter });
  const audit: AuditWriter = (companyId, event) =>
    withCompany(database, companyId, (tx) => recordAudit(tx, event));

  return {
    auth,
    database,
    trustedOrigins: [config.WEB_ORIGIN, new URL(config.BETTER_AUTH_URL).origin],
    signupLimit: options.signupLimit ?? { max: 10, windowMs: 60_000 },
    guards: createGuards({ audit }),
    createCompany: options.createCompany ?? companyCreator(database),
    googleEnabled: googleCredentials(options.config) !== null,
    resolveContext: async (headers) => {
      const user = await readSessionUser(auth, headers);
      if (!user) return null;
      return { ...user, member: await memberForUser(database, user.userId) };
    },
  };
}
