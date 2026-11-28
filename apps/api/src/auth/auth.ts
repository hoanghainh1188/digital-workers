import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  describeError,
  isCommonPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@dw/core';
import { type Database, memberForUser, recordAudit, withCompany } from '@dw/db';
import { accounts, sessions, users, verifications } from '@dw/db/auth-schema';
import { and, eq } from '@dw/db/drizzle';
import { type Mailer, resetPasswordTemplate, verifyEmailTemplate } from '@dw/mail';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import type { FastifyBaseLogger } from 'fastify';
import { type ApiConfig, googleCredentials } from '../config.ts';
import type { FailedLoginLimiter } from './failed-login-limiter.ts';

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
  /** Per-email failed sign-in counter (design D6). */
  readonly limiter: FailedLoginLimiter;
  /** Password-reset requests per email: 3 per 15 minutes (0.2 #067). */
  readonly resetLimiter: FailedLoginLimiter;
  /** Better Auth's own per-IP limiter (design D6). Defaults to on. */
  readonly ipRateLimit?: boolean;
};

/** Every Better Auth endpoint that sets a password, and the body field carrying it (#032). */
const PASSWORD_FIELDS: Readonly<Record<string, string>> = {
  '/sign-up/email': 'password',
  '/change-password': 'newPassword',
  '/set-password': 'newPassword',
  '/reset-password': 'newPassword',
};
const SIGN_IN_EMAIL = '/sign-in/email';
const REQUEST_PASSWORD_RESET = '/request-password-reset';

/**
 * Emails whose next sign-up must not send a verification email: accepting an
 * invitation proves the address (0.2 #033), so the account is marked verified instead.
 */
const skipVerificationEmail = new Set<string>();

/** Runs `fn` (an invited sign-up) without sending the usual verification email. */
export async function withoutVerificationEmail<T>(email: string, fn: () => Promise<T>): Promise<T> {
  const key = email.trim().toLowerCase();
  skipVerificationEmail.add(key);
  try {
    return await fn();
  } finally {
    skipVerificationEmail.delete(key);
  }
}

/** Better Auth instance (design D4). The only module that touches the auth.* tables. */
export function createAuth(deps: AuthDeps) {
  const { config, database, mailer, logger, limiter, resetLimiter } = deps;
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
    // Google tokens are encrypted with BETTER_AUTH_SECRET before they reach auth.accounts.
    account: { encryptOAuthTokens: true },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      requireEmailVerification: false, // 0.2 #033: usable right away
      autoSignIn: true,
      // Design D7 / 0.2 #067: one-hour single-use link; a reset signs out everywhere.
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        // Only accounts that have a password get a link (spec authentication); the
        // response is the same either way. Not awaited, like the verification email.
        if (!(await hasPasswordAccount(database, user.id))) return;
        const callback = encodeURIComponent(`${config.WEB_ORIGIN}/reset-password`);
        const url = `${config.BETTER_AUTH_URL}/api/auth/reset-password/${encodeURIComponent(token)}?callbackURL=${callback}`;
        void mailer
          .send({ to: user.email, ...resetPasswordTemplate({ name: user.name, url }) })
          .catch((error: unknown) =>
            logger.error({ error: describeError(error) }, 'password reset email failed'),
          );
      },
      // Holding the inbox proves the email: this is how the real owner takes back an
      // address someone else signed up with (0.2 #067).
      onPasswordReset: async ({ user }) => {
        await markEmailVerified(database, user.id);
        const member = await memberForUser(database, user.id);
        if (!member) return;
        await withCompany(database, member.companyId, (tx) =>
          recordAudit(tx, {
            actorMemberId: member.memberId,
            action: 'auth.password_reset',
            targetType: 'member',
            targetId: member.memberId,
          }),
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: DAY,
      // Not awaited (timing): failures are logged without the address (design risks).
      sendVerificationEmail: async ({ user, token }) => {
        if (skipVerificationEmail.has(user.email.toLowerCase())) return;
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
        [REQUEST_PASSWORD_RESET]: { window: 60, max: 5 },
      },
    },
    logger: {
      // Messages only: Better Auth may pass request data as extra arguments.
      log: (level, message) => logger[level]({ source: 'auth' }, message),
    },
    hooks: {
      // ctx.path is Better Auth's own normalised endpoint path, so URL tricks such as
      // /api/auth/./sign-in/email cannot skip these checks (code review finding).
      before: createAuthMiddleware(async (ctx) => {
        const passwordField = PASSWORD_FIELDS[ctx.path];
        if (passwordField && isCommonPassword(String(ctx.body?.[passwordField] ?? ''))) {
          throw new APIError('BAD_REQUEST', {
            code: 'PASSWORD_COMMON',
            message: 'Password is too common',
          });
        }
        if (ctx.path === SIGN_IN_EMAIL) {
          const email = emailOf(ctx.body);
          if (email && limiter.isBlocked(email)) {
            throw new APIError('TOO_MANY_REQUESTS', {
              code: 'TOO_MANY_ATTEMPTS',
              message: 'Too many failed sign-in attempts',
            });
          }
        }
        if (ctx.path === REQUEST_PASSWORD_RESET) {
          // Every request counts (not only failures): 3 per email per 15 minutes.
          const email = emailOf(ctx.body);
          if (email && resetLimiter.isBlocked(email)) {
            throw new APIError('TOO_MANY_REQUESTS', {
              code: 'TOO_MANY_REQUESTS',
              message: 'Too many password reset requests',
            });
          }
          if (email) resetLimiter.recordFailure(email);
        }
        if (ctx.path === '/verify-email') {
          await rejectUsedVerificationLink(ctx.query?.token, ctx.context.secret, (email) =>
            ctx.context.internalAdapter.findUserByEmail(email),
          );
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== SIGN_IN_EMAIL) return;
        const email = emailOf(ctx.body);
        if (!email) return;
        const status = statusOf(ctx.context.returned);
        if (status === 401) limiter.recordFailure(email);
        else if (status === undefined) limiter.reset(email);
      }),
    },
    databaseHooks: {
      session: {
        create: {
          // Every way of creating a session (email, Google, invited sign-up) goes
          // through here: a locked member gets no session (design D6, 0.2 #040).
          before: async (session) => {
            const member = await memberForUser(database, session.userId);
            if (member?.status === 'locked') {
              throw new APIError('FORBIDDEN', {
                code: 'ACCOUNT_LOCKED',
                message: 'Account is locked',
              });
            }
          },
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

async function hasPasswordAccount(database: Database, userId: string): Promise<boolean> {
  const rows = await database.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')))
    .limit(1);
  return rows.length > 0;
}

/** Marks the user's email as verified (invitation accepted, password reset). */
export async function markEmailVerified(database: Database, userId: string): Promise<void> {
  await database.db
    .update(users)
    .set({ emailVerified: true, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

/** Deletes every session of the user: the next request with an old cookie gets 401. */
export async function revokeUserSessions(database: Database, userId: string): Promise<void> {
  await database.db.delete(sessions).where(eq(sessions.userId, userId));
}

/** The id of the account with this email (any provider), or null. */
export async function userIdByEmail(database: Database, email: string): Promise<string | null> {
  const [row] = await database.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  return row?.id ?? null;
}

function emailOf(body: unknown): string | null {
  const email = (body as { email?: unknown } | null | undefined)?.email;
  return typeof email === 'string' && email.trim() !== '' ? email : null;
}

/** HTTP status of an APIError returned by the endpoint; undefined for a success. */
function statusOf(returned: unknown): number | undefined {
  const status = (returned as { statusCode?: unknown } | null | undefined)?.statusCode;
  return returned instanceof Error && typeof status === 'number' ? status : undefined;
}

/**
 * Better Auth's verification token is a stateless JWT, so it stays valid until it
 * expires. The spec wants a link to work once: once the email is verified, reopening
 * a genuine link is refused instead of silently succeeding. The signature is checked
 * first, so forged tokens cannot be used to probe which emails are verified.
 */
async function rejectUsedVerificationLink(
  token: unknown,
  secret: string,
  findUserByEmail: (email: string) => Promise<{ user: { emailVerified: boolean } } | null>,
): Promise<void> {
  const payload = typeof token === 'string' ? verifiedHs256Payload(token, secret) : null;
  const email = payload?.email;
  if (typeof email !== 'string' || payload?.updateTo !== undefined) return;
  const found = await findUserByEmail(email);
  if (found?.user.emailVerified) {
    throw new APIError('BAD_REQUEST', {
      code: 'TOKEN_ALREADY_USED',
      message: 'Verification link is no longer valid',
    });
  }
}

/** Payload of an HS256 JWT signed with `secret`, or null (bad signature, alg or format). */
export function verifiedHs256Payload(
  token: string,
  secret: string,
): Record<string, unknown> | null {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) return null;
  try {
    const alg = JSON.parse(Buffer.from(header, 'base64url').toString()).alg;
    if (alg !== 'HS256') return null;
    const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
