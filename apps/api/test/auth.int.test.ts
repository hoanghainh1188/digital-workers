import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFailedLoginLimiter } from '../src/auth/index.ts';
import {
  auditEventsOf,
  cookieHeader,
  get,
  type Harness,
  makeApp,
  STRONG_PASSWORD,
  signIn,
  signUp,
  startHarness,
  type TestApp,
  uniqueEmail,
  verificationLink,
  WEB_ORIGIN,
} from './support/harness.ts';

describe('authentication (spec authentication)', () => {
  let harness: Harness;
  let t: TestApp;

  beforeAll(async () => {
    harness = await startHarness();
    t = makeApp(harness);
  });

  afterAll(async () => {
    await t?.app.close();
    await harness?.stop();
  });

  describe('sign-in with email and password', () => {
    it('correct credentials create a cookie session; /api/me returns user, company and role', async () => {
      const { email, companyId } = await signUp(t.app);
      const res = await signIn(t.app, email);
      expect(res.statusCode).toBe(200);
      const me = await get(t.app, '/api/me', cookieHeader(res));
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({
        user: { email, emailVerified: false },
        member: { role: 'owner' },
        company: { id: companyId, name: 'Gốm An Phú' },
      });
    });

    it('a wrong password and an unknown email get the same status and message', async () => {
      const { email } = await signUp(t.app);
      const wrongPassword = await signIn(t.app, email, 'not the right password');
      const unknownEmail = await signIn(t.app, uniqueEmail('nobody'), 'not the right password');
      expect(wrongPassword.statusCode).toBe(401);
      expect(unknownEmail.statusCode).toBe(wrongPassword.statusCode);
      expect(unknownEmail.json()).toEqual(wrongPassword.json());
    });

    it('a successful sign-in writes an AuditEvent without password, token or cookie', async () => {
      const { email, companyId } = await signUp(t.app);
      const res = await signIn(t.app, email);
      const events = await auditEventsOf(harness, companyId ?? '');
      expect(events.map((event) => event.action)).toContain('auth.signed_in');
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain(STRONG_PASSWORD);
      for (const cookie of res.cookies) expect(serialized).not.toContain(cookie.value);
    });
  });

  describe('session', () => {
    it('the session cookie is httpOnly and SameSite=Lax', async () => {
      const { email } = await signUp(t.app);
      const res = await signIn(t.app, email);
      const session = res.cookies.find((cookie) => cookie.name.endsWith('session_token'));
      expect(session).toBeDefined();
      expect(session?.httpOnly).toBe(true);
      expect(session?.sameSite).toBe('Lax');
    });

    it('after sign-out the old cookie no longer works', async () => {
      const { email } = await signUp(t.app);
      const cookie = cookieHeader(await signIn(t.app, email));
      expect((await get(t.app, '/api/me', cookie)).statusCode).toBe(200);
      const out = await t.app.inject({
        method: 'POST',
        url: '/api/auth/sign-out',
        headers: { origin: WEB_ORIGIN, cookie },
      });
      expect(out.statusCode).toBe(200);
      expect((await get(t.app, '/api/me', cookie)).statusCode).toBe(401);
    });

    it.each(['/api/me', '/api/company', '/api/members/00000000-0000-4000-8000-000000000000'])(
      '%s without a session → 401',
      async (url) => {
        expect((await get(t.app, url)).statusCode).toBe(401);
      },
    );
  });

  describe('password rules on the Better Auth endpoint too', () => {
    it.each([
      ['abcdefghi', 'too short'],
      ['1234567890', 'too common'],
    ])('POST /api/auth/sign-up/email rejects %s (%s)', async (password) => {
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: WEB_ORIGIN },
        payload: { name: 'X', email: uniqueEmail(), password },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('email verification', () => {
    it('sign-up sends a link and /api/me reports unverified', async () => {
      const { email, cookie } = await signUp(t.app);
      expect(verificationLink(t.sent, email)).toMatch(`${WEB_ORIGIN}/verify-email?token=`);
      expect((await get(t.app, '/api/me', cookie)).json().user.emailVerified).toBe(false);
    });

    it('the link verifies once; reopening it is refused and changes nothing', async () => {
      const { email, cookie } = await signUp(t.app);
      const token = new URL(verificationLink(t.sent, email)).searchParams.get('token') ?? '';
      const verifyUrl = `/api/auth/verify-email?token=${encodeURIComponent(token)}`;

      const first = await get(t.app, verifyUrl);
      expect(first.statusCode).toBe(200);
      expect((await get(t.app, '/api/me', cookie)).json().user.emailVerified).toBe(true);

      const again = await get(t.app, verifyUrl);
      expect(again.statusCode).toBe(400);
      expect(again.json().code).toBe('TOKEN_ALREADY_USED');
      expect((await get(t.app, '/api/me', cookie)).json().user.emailVerified).toBe(true);
    });

    it('a tampered token is refused', async () => {
      const res = await get(t.app, '/api/auth/verify-email?token=not-a-jwt');
      expect(res.statusCode).toBe(401);
    });

    it('an unverified user can ask for a new link', async () => {
      const { email, cookie } = await signUp(t.app);
      const before = t.sent.filter((item) => item.to === email).length;
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/auth/send-verification-email',
        headers: { origin: WEB_ORIGIN, cookie },
        payload: { email },
      });
      expect(res.statusCode).toBe(200);
      await vi_waitFor(() => t.sent.filter((item) => item.to === email).length > before);
    });
  });

  it('passwords never reach the log', async () => {
    const { email } = await signUp(t.app);
    await signIn(t.app, email, 'wrong-password-LOGCHECK');
    await signIn(t.app, email);
    expect(t.logs()).not.toContain(STRONG_PASSWORD);
    expect(t.logs()).not.toContain('wrong-password-LOGCHECK');
  });
});

describe('failed sign-in limit per email (0.2 #044)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness();
  });

  afterAll(async () => {
    await harness?.stop();
  });

  it('10 failures in 15 minutes → the 11th attempt gets 429 even with the right password', async () => {
    const t = makeApp(harness);
    try {
      const { email } = await signUp(t.app);
      for (let i = 0; i < 10; i += 1) {
        expect((await signIn(t.app, email, `wrong password ${i}`)).statusCode).toBe(401);
      }
      const blocked = await signIn(t.app, email.toUpperCase());
      expect(blocked.statusCode).toBe(429);
      // Another email is not affected.
      const other = await signUp(t.app);
      expect((await signIn(t.app, other.email)).statusCode).toBe(200);
    } finally {
      await t.app.close();
    }
  });

  it('a successful sign-in clears the counter', async () => {
    const t = makeApp(harness, { limiter: createFailedLoginLimiter() });
    try {
      const { email } = await signUp(t.app);
      for (let i = 0; i < 9; i += 1) await signIn(t.app, email, `wrong password ${i}`);
      expect((await signIn(t.app, email)).statusCode).toBe(200);
      for (let i = 0; i < 9; i += 1) {
        expect((await signIn(t.app, email, `wrong again ${i}`)).statusCode).toBe(401);
      }
      expect((await signIn(t.app, email)).statusCode).toBe(200);
    } finally {
      await t.app.close();
    }
  });

  it('Better Auth limits by IP as well (X-Forwarded-For behind the proxy)', async () => {
    const t = makeApp(harness, { ipRateLimit: true, trustProxy: true });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 31; i += 1) {
        const res = await t.app.inject({
          method: 'POST',
          url: '/api/auth/sign-in/email',
          headers: { origin: WEB_ORIGIN, 'x-forwarded-for': '203.0.113.7' },
          payload: { email: uniqueEmail('ip'), password: 'whatever whatever' },
        });
        statuses.push(res.statusCode);
      }
      expect(statuses.at(-1)).toBe(429);
    } finally {
      await t.app.close();
    }
  });
});

async function vi_waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
