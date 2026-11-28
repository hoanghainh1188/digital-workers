import { createDatabase, type Database } from '@dw/db';
import { startTestPostgres, type TestPostgres } from '@dw/db/testing';
import { createMemoryMailer, type SentEmail } from '@dw/mail';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { type AppDeps, buildApp, type PlatformDeps } from '../../src/app.ts';
import { createPlatform, type PlatformOptions } from '../../src/platform.ts';
import { captureLogger } from '../log-capture.ts';

export const WEB_ORIGIN = 'http://localhost:5173';
export const STRONG_PASSWORD = 'gom an phu bat trang';

const testConfig = {
  BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-0123456789',
  BETTER_AUTH_URL: WEB_ORIGIN,
  WEB_ORIGIN,
  NODE_ENV: 'test',
  GOOGLE_CLIENT_ID: undefined,
  GOOGLE_CLIENT_SECRET: undefined,
} as const;

export type Harness = {
  readonly pg: TestPostgres;
  readonly database: Database;
  /** dw_owner connection, for assertions that must see every company. */
  readonly owner: Database;
  readonly stop: () => Promise<void>;
};

export async function startHarness(): Promise<Harness> {
  const pg = await startTestPostgres();
  const database = createDatabase(pg.appUrl);
  const owner = createDatabase(pg.ownerUrl, { max: 2 });
  return {
    pg,
    database,
    owner,
    stop: async () => {
      await database.close();
      await owner.close();
      await pg.stop();
    },
  };
}

export type TestApp = {
  readonly app: FastifyInstance;
  readonly platform: PlatformDeps;
  readonly sent: readonly SentEmail[];
  readonly logs: () => string;
};

export function makeApp(
  harness: Harness,
  overrides: Partial<PlatformOptions> & Pick<AppDeps, 'trustProxy'> = {},
): TestApp {
  const capture = captureLogger();
  const { mailer, sent } = createMemoryMailer();
  const platform = createPlatform({
    config: testConfig,
    database: harness.database,
    mailer,
    logger: capture.logger,
    ipRateLimit: false,
    signupLimit: { max: 10_000, windowMs: 60_000 },
    invitationLimit: { max: 10_000, windowMs: 60_000 },
    ...overrides,
  });
  const app = buildApp({
    logger: capture.logger,
    trustProxy: overrides.trustProxy,
    checkDatabase: async () => true,
    platform,
  });
  return { app, platform, sent, logs: capture.text };
}

/** "name=value; name2=value2" from a response's Set-Cookie headers. */
export function cookieHeader(res: LightMyRequestResponse): string {
  return res.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

let counter = 0;
export function uniqueEmail(label = 'user'): string {
  counter += 1;
  return `${label}-${Date.now()}-${counter}@example.com`;
}

export type SignedUp = { email: string; cookie: string; companyId: string | null };

export async function signUp(
  app: FastifyInstance,
  input: { companyName?: string; email?: string; name?: string; phone?: string } = {},
): Promise<SignedUp> {
  const email = input.email ?? uniqueEmail();
  const res = await app.inject({
    method: 'POST',
    url: '/api/signup',
    headers: { origin: WEB_ORIGIN },
    payload: {
      companyName: input.companyName ?? 'Gốm An Phú',
      name: input.name ?? 'Nguyễn An',
      email,
      password: STRONG_PASSWORD,
      ...(input.phone ? { phone: input.phone } : {}),
    },
  });
  if (res.statusCode !== 201) throw new Error(`sign-up failed: ${res.statusCode} ${res.body}`);
  return { email, cookie: cookieHeader(res), companyId: res.json().companyId };
}

export function signIn(app: FastifyInstance, email: string, password = STRONG_PASSWORD) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { origin: WEB_ORIGIN },
    payload: { email, password },
  });
}

export function get(app: FastifyInstance, url: string, cookie?: string) {
  return app.inject({
    method: 'GET',
    url,
    headers: { origin: WEB_ORIGIN, ...(cookie ? { cookie } : {}) },
  });
}

/** Rows of a table across all companies (dw_owner sees members; others are read per company). */
export async function auditEventsOf(harness: Harness, companyId: string) {
  const client = await harness.database.pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.company_id', $1, true)", [companyId]);
    const { rows } = await client.query(
      'select actor_member_id, action, target_type, target_id, fields from audit_events order by created_at',
    );
    await client.query('commit');
    return rows as Array<{
      actor_member_id: string | null;
      action: string;
      target_type: string;
      target_id: string | null;
      fields: string[] | null;
    }>;
  } finally {
    client.release();
  }
}

export function verificationLink(sent: readonly SentEmail[], to: string): string {
  const email = [...sent].reverse().find((item) => item.to === to);
  const match = email?.text.match(/https?:\/\/\S+/);
  if (!match) throw new Error(`no verification email for ${to}`);
  return match[0];
}
