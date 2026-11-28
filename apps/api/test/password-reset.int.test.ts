import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  WEB_ORIGIN,
} from './support/harness.ts';

const NEW_PASSWORD = 'binh minh tren song hong';

describe('forgot / reset password (spec authentication, design D7)', () => {
  let harness: Harness;
  let t: TestApp;

  const requestReset = (email: string) =>
    t.app.inject({
      method: 'POST',
      url: '/api/auth/request-password-reset',
      headers: { origin: WEB_ORIGIN },
      payload: { email },
    });
  const resetPassword = (token: string, newPassword: string) =>
    t.app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      headers: { origin: WEB_ORIGIN },
      payload: { token, newPassword },
    });
  const resetEmails = (to: string) =>
    t.sent.filter((mail) => mail.to === to && mail.subject.includes('Đặt lại mật khẩu'));
  /** The token from the newest reset email (link /api/auth/reset-password/<token>?callbackURL=…). */
  const resetToken = (to: string) => {
    const match = resetEmails(to)
      .at(-1)
      ?.text.match(/\/api\/auth\/reset-password\/([^?\s]+)\?callbackURL=/);
    if (!match?.[1]) throw new Error(`no reset email for ${to}`);
    return decodeURIComponent(match[1]);
  };

  beforeAll(async () => {
    harness = await startHarness();
    t = makeApp(harness);
  });

  afterAll(async () => {
    await t?.app.close();
    await harness?.stop();
  });

  describe('Quên mật khẩu', () => {
    it('Email có tài khoản: a link is emailed; Email không có tài khoản: same response, no email', async () => {
      const { email } = await signUp(t.app);
      const known = await requestReset(email);
      const unknownEmail = uniqueEmail('ghost');
      const unknown = await requestReset(unknownEmail);
      expect(known.statusCode).toBe(200);
      expect(unknown.statusCode).toBe(known.statusCode);
      expect(unknown.body).toBe(known.body);
      expect(resetEmails(email)).toHaveLength(1);
      expect(resetEmails(email)[0]?.text).toContain(
        `callbackURL=${encodeURIComponent(`${WEB_ORIGIN}/reset-password`)}`,
      );
      expect(t.sent.some((mail) => mail.to === unknownEmail)).toBe(false);
    });

    it('an account without a password (Google only) gets no link', async () => {
      const { email } = await signUp(t.app);
      await harness.database.pool.query(
        "delete from auth.accounts where provider_id = 'credential' and user_id = (select id from auth.users where email = $1)",
        [email],
      );
      expect((await requestReset(email)).statusCode).toBe(200);
      expect(resetEmails(email)).toHaveLength(0);
    });

    it('Yêu cầu liên tục: the 4th request for one email within 15 minutes → 429', async () => {
      const { email } = await signUp(t.app);
      const codes = [];
      for (let i = 0; i < 5; i += 1) codes.push((await requestReset(email)).statusCode);
      expect(codes).toEqual([200, 200, 200, 429, 429]);
      expect(resetEmails(email)).toHaveLength(3);
    });

    it('limits by IP as well (Better Auth custom rule, 5 per minute)', async () => {
      const limited = makeApp(harness, { ipRateLimit: true, trustProxy: true });
      try {
        const codes: number[] = [];
        for (let i = 0; i < 7; i += 1) {
          const res = await limited.app.inject({
            method: 'POST',
            url: '/api/auth/request-password-reset',
            headers: { origin: WEB_ORIGIN, 'x-forwarded-for': '203.0.113.9' },
            payload: { email: uniqueEmail(`ip${i}`) },
          });
          codes.push(res.statusCode);
        }
        expect(codes.slice(0, 5).every((code) => code === 200)).toBe(true);
        expect(codes.slice(5)).toEqual([429, 429]);
      } finally {
        await limited.app.close();
      }
    });
  });

  describe('Đặt lại mật khẩu', () => {
    it('Đặt lại thành công: new password works, old one does not, the old session gets 401', async () => {
      const { email, cookie: oldSession, companyId } = await signUp(t.app);
      expect((await get(t.app, '/api/me', oldSession)).statusCode).toBe(200);
      await requestReset(email);
      const res = await resetPassword(resetToken(email), NEW_PASSWORD);
      expect(res.statusCode).toBe(200);
      expect((await get(t.app, '/api/me', oldSession)).statusCode).toBe(401);
      expect((await signIn(t.app, email, STRONG_PASSWORD)).statusCode).toBe(401);
      const signedIn = await signIn(t.app, email, NEW_PASSWORD);
      expect(signedIn.statusCode).toBe(200);
      const me = (await get(t.app, '/api/me', cookieHeader(signedIn))).json();
      expect(me.user.emailVerified).toBe(true);
      const event = (await auditEventsOf(harness, companyId ?? '')).find(
        (item) => item.action === 'auth.password_reset',
      );
      expect(event).toMatchObject({ actor_member_id: me.member.id, target_id: me.member.id });
    });

    it('Mật khẩu mới quá phổ biến → refused as too common; the link still works', async () => {
      const { email } = await signUp(t.app);
      await requestReset(email);
      const token = resetToken(email);
      const res = await resetPassword(token, '1234567890');
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('PASSWORD_COMMON');
      expect((await resetPassword(token, NEW_PASSWORD)).statusCode).toBe(200);
    });

    it('Dùng lại link: a used link is refused, and opening it redirects with an error', async () => {
      const { email } = await signUp(t.app);
      await requestReset(email);
      const token = resetToken(email);
      expect((await resetPassword(token, NEW_PASSWORD)).statusCode).toBe(200);
      const again = await resetPassword(token, 'mot cau khac du dai');
      expect(again.statusCode).toBe(400);
      expect(again.json().code).toBe('INVALID_TOKEN');
      const open = await t.app.inject({
        method: 'GET',
        url: `/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent(`${WEB_ORIGIN}/reset-password`)}`,
      });
      expect(open.statusCode).toBe(302);
      expect(open.headers.location).toBe(`${WEB_ORIGIN}/reset-password?error=INVALID_TOKEN`);
    });

    it('a link older than 1 hour is refused', async () => {
      const { email } = await signUp(t.app);
      await requestReset(email);
      const token = resetToken(email);
      await harness.database.pool.query(
        "update auth.verifications set expires_at = now() - interval '1 second' where identifier = $1",
        [`reset-password:${token}`],
      );
      expect((await resetPassword(token, NEW_PASSWORD)).statusCode).toBe(400);
    });

    it('the link is valid for 1 hour', async () => {
      const { email } = await signUp(t.app);
      await requestReset(email);
      const { rows } = await harness.database.pool.query(
        'select expires_at from auth.verifications where identifier = $1',
        [`reset-password:${resetToken(email)}`],
      );
      const minutes = (new Date(rows[0].expires_at).getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(58);
      expect(minutes).toBeLessThanOrEqual(60);
    });

    it('Lấy lại email bị đăng ký trước: the squatter’s sessions die and the email is verified', async () => {
      const victim = uniqueEmail('victim');
      const squatter = await t.app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: WEB_ORIGIN },
        payload: { name: 'Kẻ chiếm', email: victim, password: STRONG_PASSWORD },
      });
      const squatterCookie = cookieHeader(squatter);
      expect((await get(t.app, '/api/me', squatterCookie)).json().user.emailVerified).toBe(false);
      await requestReset(victim);
      expect((await resetPassword(resetToken(victim), NEW_PASSWORD)).statusCode).toBe(200);
      expect((await get(t.app, '/api/me', squatterCookie)).statusCode).toBe(401);
      const owner = await signIn(t.app, victim, NEW_PASSWORD);
      expect((await get(t.app, '/api/me', cookieHeader(owner))).json().user.emailVerified).toBe(
        true,
      );
    });

    it('reset tokens never reach the log', async () => {
      const { email } = await signUp(t.app);
      await requestReset(email);
      const token = resetToken(email);
      await resetPassword(token, NEW_PASSWORD);
      expect(t.logs()).not.toContain(token);
      expect(t.logs()).not.toContain(NEW_PASSWORD);
    });
  });
});
