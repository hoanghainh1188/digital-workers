import {
  describeError,
  isCommonPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@dw/core';
import { type Database, memberForUser, recordAudit, withCompany } from '@dw/db';
import { accounts, sessions, users, verifications } from '@dw/db/auth-schema';
import { type Mailer, verifyEmailTemplate } from '@dw/mail';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import type { FastifyBaseLogger } from 'fastify';
import { type ApiConfig, googleCredentials } from '../config.ts';

const DAY = 60 * 60 * 24;

export type AuthDeps = {
  readonly config: Pick<
    ApiConfig,
    | 'BETTER_AUTH_SECRET'
    | 'BETTER_AUTH_URL'
    | 'WEB_ORIGIN'
    | 'NODE_ENV'
    | 'GOOGLE_CLIENT_ID'
    | 'GOOGLE_CLIENT_SECRET'
  >;
  readonly database: Database;
  readonly mailer: Mailer;
  readonly logger: FastifyBaseLogger;
  /** Better Auth's own per-IP limiter (design D6). Defaults to on. */
  readonly ipRateLimit?: boolean;
};

/** Better Auth instance (design D4). The only module that touches the auth.* tables. */
export function createAuth(deps: AuthDeps) {
  const { config, database, mailer, logger } = deps;
  const google = googleCredentials(config);

  return betterAuth({
    appName: 'Digital Workers',
    baseURL: config.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.WEB_ORIGIN, new URL(config.BETTER_AUTH_URL).origin],
    telemetry: { enabled: false },
    database: drizzleAdapter(database.db, {
      provider: 'pg',
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    advanced: {
      database: { generateId: 'uuid' },
      cookiePrefix: 'dw',
      useSecureCookies: config.NODE_ENV === 'production',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
    },
    session: { expiresIn: 30 * DAY, updateAge: DAY }, // 0.2 #043
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      requireEmailVerification: false, // 0.2 #033: usable right away
      autoSignIn: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: DAY,
      // Not awaited (timing): failures are logged without the address (design risks).
      sendVerificationEmail: async ({ user, token }) => {
        const url = `${config.WEB_ORIGIN}/verify-email?token=${encodeURIComponent(token)}`;
        void mailer
          .send({ to: user.email, ...verifyEmailTemplate({ name: user.name, url }) })
          .catch((error: unknown) =>
            logger.error({ error: describeError(error) }, 'verification email failed'),
          );
      },
    },
    ...(google ? { socialProviders: { google } } : {}),
    rateLimit: {
      enabled: deps.ipRateLimit ?? true,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 30 },
        '/sign-up/email': { window: 60, max: 10 },
        '/send-verification-email': { window: 60, max: 5 },
      },
    },
    logger: {
      // Messages only: Better Auth may pass request data as extra arguments.
      log: (level, message) => logger[level]({ source: 'auth' }, message),
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-up/email' && isCommonPassword(String(ctx.body?.password ?? ''))) {
          throw new APIError('BAD_REQUEST', {
            code: 'PASSWORD_COMMON',
            message: 'Password is too common',
          });
        }
        if (ctx.path === '/verify-email') {
          await rejectUsedVerificationLink(ctx.query?.token, (email) =>
            ctx.context.internalAdapter.findUserByEmail(email),
          );
        }
      }),
    },
    databaseHooks: {
      session: {
        create: {
          // AuditEvent for a successful sign-in, when the user already belongs to a company.
          after: async (session) => {
            const member = await memberForUser(database, session.userId);
            if (!member) return;
            await withCompany(database, member.companyId, (tx) =>
              recordAudit(tx, {
                actorMemberId: member.memberId,
                action: 'auth.signed_in',
                targetType: 'member',
                targetId: member.memberId,
              }),
            ).catch((error: unknown) =>
              logger.error({ error: describeError(error) }, 'sign-in audit failed'),
            );
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * Better Auth's verification token is a stateless JWT, so it stays valid until it
 * expires. The spec wants a link to work once: once the email is verified, reopening
 * the link is refused instead of silently succeeding. Decoding without verifying
 * the signature is safe here: it can only lead to a refusal, never to verification.
 */
async function rejectUsedVerificationLink(
  token: unknown,
  findUserByEmail: (email: string) => Promise<{ user: { emailVerified: boolean } } | null>,
): Promise<void> {
  const email = typeof token === 'string' ? unverifiedJwtEmail(token) : null;
  if (!email) return;
  const found = await findUserByEmail(email);
  if (found?.user.emailVerified) {
    throw new APIError('BAD_REQUEST', {
      code: 'TOKEN_ALREADY_USED',
      message: 'Verification link is no longer valid',
    });
  }
}

function unverifiedJwtEmail(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString());
    return typeof payload?.email === 'string' && !payload.updateTo ? payload.email : null;
  } catch {
    return null;
  }
}
