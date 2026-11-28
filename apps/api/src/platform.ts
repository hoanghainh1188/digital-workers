import { grantTrial, type Notifier } from '@dw/billing';
import { createBudgetAlerter } from '@dw/channels';
import { describeError } from '@dw/core';
import { createSecretBox } from '@dw/crypto';
import { type Database, memberForUser, messageById, recordAudit, withCompany } from '@dw/db';
import type { TaskQueue } from '@dw/db/queue';
import {
  createProviderKeyStore,
  type KeyCheck,
  type ProviderKeyStore,
  verifyProviderKey,
} from '@dw/llm';
import type { Mailer } from '@dw/mail';
import type { FastifyBaseLogger } from 'fastify';
import type { PlatformDeps } from './app.ts';
import {
  type AuthDeps,
  createAuth,
  createFailedLoginLimiter,
  type FailedLoginLimiter,
  isPlatformAdminEmail,
  readSessionUser,
} from './auth/index.ts';
import { createChatHub } from './chat/hub.ts';
import { type ApiConfig, googleCredentials } from './config.ts';
import { emailNotifier } from './credit/notifier.ts';
import { createLastSeenTracker } from './org/members.ts';
import { createPlatformGuard } from './platform/guard.ts';
import type { RequestLimit } from './plugins/request-guards.ts';
import { type AuditWriter, companyCreator, createGuards } from './tenancy/index.ts';

export type PlatformOptions = {
  readonly config: AuthDeps['config'] & Pick<ApiConfig, 'ENCRYPTION_KEY'>;
  readonly database: Database;
  readonly mailer: Mailer;
  readonly logger: FastifyBaseLogger;
  readonly ipRateLimit?: boolean;
  readonly limiter?: FailedLoginLimiter;
  readonly createCompany?: PlatformDeps['createCompany'];
  /** Per-IP limit on POST /api/signup and /api/companies. Default: 10 per minute. */
  readonly signupLimit?: RequestLimit;
  /** Per-IP limit on the public invitation endpoints. Default: 20 per minute (design D4). */
  readonly invitationLimit?: RequestLimit;
  /** Password-reset requests per email. Default: 3 per 15 minutes (0.2 #067). */
  readonly resetLimiter?: FailedLoginLimiter;
  /** Checks a provider key before it is saved. Default: the provider's model listing. */
  readonly verifyKey?: PlatformDeps['verifyKey'];
  /** Credit emails. Default: email to the company's Owners / Admins / Trưởng phòng. */
  readonly notifier?: Notifier;
  readonly now?: () => Date;
  readonly keys?: ProviderKeyStore;
  /** pg-boss in production (main.ts); a recording queue in tests. */
  readonly chatQueue: TaskQueue;
  /** Web chat messages per member. Default: 20 per minute (0.2 #133). */
  readonly chatSendLimit?: RequestLimit;
  readonly chatRecheckMs?: number;
};

/** Wires auth, request context, guards and services for `buildApp` (main and tests). */
export function createPlatform(options: PlatformOptions): PlatformDeps {
  const { database, config } = options;
  const limiter = options.limiter ?? createFailedLoginLimiter();
  const resetLimiter = options.resetLimiter ?? createFailedLoginLimiter({ maxFailures: 3 });
  const isPlatformAdmin = (email: string) => isPlatformAdminEmail(config, email);
  // Trial credit when an Owner's email becomes verified (design D8). Never fails the caller.
  const onEmailVerified = async (userId: string) => {
    try {
      const member = await memberForUser(database, userId);
      if (member?.role !== 'owner') return;
      await grantTrial(database, member.companyId).catch(() =>
        grantTrial(database, member.companyId),
      );
    } catch (error) {
      // Can still be granted by hand (reason "Credit dùng thử").
      options.logger.error({ error: describeError(error) }, 'trial credit failed');
    }
  };
  const auth = createAuth({ ...options, limiter, resetLimiter, onEmailVerified });
  const touchLastSeen = createLastSeenTracker(database);
  const audit: AuditWriter = (companyId, event) =>
    withCompany(database, companyId, (tx) => recordAudit(tx, event));
  const keys =
    options.keys ??
    createProviderKeyStore({ database, box: createSecretBox(config.ENCRYPTION_KEY) });
  const verifyKey =
    options.verifyKey ??
    ((provider, apiKey): Promise<KeyCheck> => verifyProviderKey(provider, apiKey));

  return {
    auth,
    database,
    trustedOrigins: [config.WEB_ORIGIN, new URL(config.BETTER_AUTH_URL).origin],
    signupLimit: options.signupLimit ?? { max: 10, windowMs: 60_000 },
    guards: createGuards({ audit }),
    audit,
    mailer: options.mailer,
    webOrigin: config.WEB_ORIGIN,
    invitationLimit: options.invitationLimit ?? { max: 20, windowMs: 60_000 },
    createCompany: options.createCompany ?? companyCreator(database, options.logger),
    googleEnabled: googleCredentials(options.config) !== null,
    isPlatformAdmin,
    onEmailVerified,
    platformGuard: createPlatformGuard({ audit, isPlatformAdmin, now: options.now }),
    keys,
    verifyKey,
    notifier:
      options.notifier ??
      emailNotifier({
        database,
        mailer: options.mailer,
        webOrigin: config.WEB_ORIGIN,
        logger: options.logger,
      }),
    now: options.now,
    chat: {
      queue: options.chatQueue,
      sendLimit: options.chatSendLimit ?? { max: 20, windowMs: 60_000 },
      onBudgetExhausted: createBudgetAlerter({
        database,
        mailer: options.mailer,
        webOrigin: config.WEB_ORIGIN,
        logger: options.logger,
      }),
      onQueueError: (error: unknown) =>
        options.logger.error({ error: describeError(error) }, 'task job not sent'),
      hub: createChatHub({
        readMessage: (companyId, messageId) =>
          withCompany(database, companyId, (tx) => messageById(tx, messageId)),
        onError: (error) =>
          options.logger.error({ error: describeError(error) }, 'chat push failed'),
      }),
      recheckMs: options.chatRecheckMs,
    },
    resolveContext: async (headers) => {
      const user = await readSessionUser(auth, headers);
      if (!user) return null;
      const member = await memberForUser(database, user.userId);
      // "Hoạt động" column (design D6): best effort, never fails the request.
      if (member?.status === 'active') {
        await touchLastSeen(member).catch((error: unknown) =>
          options.logger.warn({ error: describeError(error) }, 'last_seen update failed'),
        );
      }
      return { ...user, member };
    },
  };
}
