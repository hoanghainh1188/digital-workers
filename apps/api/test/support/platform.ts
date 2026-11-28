import { createHmac, randomUUID } from 'node:crypto';
import { adjustCredit } from '@dw/billing';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import {
  cookieHeader,
  type Harness,
  PLATFORM_ADMIN_EMAIL,
  STRONG_PASSWORD,
  signIn,
  type TestApp,
  WEB_ORIGIN,
} from './harness.ts';
import { call, verifyEmail } from './org.ts';

/** RFC 4648 base32 → bytes (TOTP secrets in otpauth:// URIs). */
function base32(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of text.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('bad base32');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) — what an authenticator app shows. */
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac('sha1', base32(secret)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

/** Merges the cookies of `res` into an existing Cookie header (later wins). */
export function mergeCookies(cookie: string, res: LightMyRequestResponse): string {
  const jar = new Map(
    cookie
      .split('; ')
      .filter(Boolean)
      .map((pair) => [pair.split('=')[0] ?? '', pair] as const),
  );
  for (const item of res.cookies) {
    if (item.value === '' || item.maxAge === 0) jar.delete(item.name);
    else jar.set(item.name, `${item.name}=${item.value}`);
  }
  return [...jar.values()].join('; ');
}

export function authPost(app: FastifyInstance, url: string, cookie: string, payload: object) {
  return app.inject({
    method: 'POST',
    url: `/api/auth${url}`,
    headers: { origin: WEB_ORIGIN, cookie },
    payload,
  });
}

export type PlatformAdmin = { cookie: string; secret: string; userId: string };

/** Signs up PLATFORM_ADMIN_EMAIL (no company), verifies the email, and turns TOTP on. */
export async function setUpPlatformAdmin(t: TestApp, harness: Harness): Promise<PlatformAdmin> {
  const signup = await t.app.inject({
    method: 'POST',
    url: '/api/signup',
    headers: { origin: WEB_ORIGIN },
    payload: {
      companyName: 'Không dùng',
      name: 'Harry',
      email: PLATFORM_ADMIN_EMAIL,
      password: STRONG_PASSWORD,
    },
  });
  if (signup.statusCode !== 201) throw new Error(`admin sign-up: ${signup.statusCode}`);
  await verifyEmail(harness, PLATFORM_ADMIN_EMAIL);
  let cookie = cookieHeader(signup);
  const enabled = await authPost(t.app, '/two-factor/enable', cookie, {
    password: STRONG_PASSWORD,
  });
  if (enabled.statusCode !== 200)
    throw new Error(`enable 2fa: ${enabled.statusCode} ${enabled.body}`);
  cookie = mergeCookies(cookie, enabled);
  const secret = new URL(enabled.json().totpURI).searchParams.get('secret') ?? '';
  const verified = await authPost(t.app, '/two-factor/verify-totp', cookie, { code: totp(secret) });
  if (verified.statusCode !== 200)
    throw new Error(`verify 2fa: ${verified.statusCode} ${verified.body}`);
  cookie = mergeCookies(cookie, verified);
  const me = (await call(t.app, 'GET', '/api/me', cookie)).json();
  return { cookie, secret, userId: me.user.id };
}

/** Email + password, then the TOTP code (next 30 s window, so a code is never reused). */
export async function signInPlatformAdmin(t: TestApp, admin: PlatformAdmin): Promise<string> {
  const first = await signIn(t.app, PLATFORM_ADMIN_EMAIL);
  if (first.json().twoFactorRedirect !== true) throw new Error('expected a TOTP challenge');
  const challenge = cookieHeader(first);
  const verified = await authPost(t.app, '/two-factor/verify-totp', challenge, {
    code: totp(admin.secret, Date.now() + 30_000),
  });
  if (verified.statusCode !== 200) throw new Error(`totp: ${verified.statusCode} ${verified.body}`);
  return mergeCookies(challenge, verified);
}

/** Adds credit to a company directly through the ledger (fixture). */
export async function giveCredit(harness: Harness, companyId: string, amountVnd: number) {
  await adjustCredit(harness.database, {
    companyId,
    direction: 'credit',
    amountVnd,
    reason: 'other',
    note: 'fixture',
    actorAdminId: randomUUID(),
    idempotencyKey: randomUUID(),
  });
}
