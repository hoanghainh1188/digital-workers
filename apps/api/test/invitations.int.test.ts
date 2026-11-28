import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditEventsOf,
  cookieHeader,
  get,
  type Harness,
  makeApp,
  STRONG_PASSWORD,
  signUp,
  startHarness,
  type TestApp,
  uniqueEmail,
  WEB_ORIGIN,
} from './support/harness.ts';
import {
  call,
  createDepartment,
  invitationToken,
  memberRow,
  type OrgTenant,
  seedOrg,
  sqlIn,
} from './support/org.ts';

describe('invitations (spec invitations)', () => {
  let harness: Harness;
  let t: TestApp;
  let a: OrgTenant;
  let b: OrgTenant;

  const invite = (cookie: string, body: unknown) =>
    call(t.app, 'POST', '/api/invitations', cookie, body);
  const inviteOne = async (
    email: string,
    role = 'member',
    departmentId: string | null = a.departmentId,
  ) => {
    const res = await invite(a.owner.cookie, { emails: [email], role, departmentId });
    if (res.statusCode !== 201) throw new Error(`invite: ${res.statusCode} ${res.body}`);
    return { id: res.json().invited[0].id as string, token: invitationToken(t.sent, email) };
  };
  const preview = (token: string) =>
    call(t.app, 'POST', '/api/invitations/preview', undefined, { token });
  const accept = (body: unknown, cookie?: string) =>
    call(t.app, 'POST', '/api/invitations/accept', cookie, body);
  const lastAudit = async (companyId: string, action: string) =>
    (await auditEventsOf(harness, companyId)).filter((event) => event.action === action).at(-1);
  const expire = (companyId: string, id: string) =>
    sqlIn(
      harness,
      companyId,
      "update invitations set expires_at = now() - interval '1 minute' where id = $1",
      [id],
    );

  beforeAll(async () => {
    harness = await startHarness();
    t = makeApp(harness);
    a = await seedOrg(t, harness, 'Gốm An Phú');
    b = await seedOrg(t, harness, 'Công ty B');
  });

  afterAll(async () => {
    await t?.app.close();
    await harness?.stop();
  });

  describe('Gửi lời mời', () => {
    it('Mời hai người: two pending invitations, one email each, one AuditEvent each', async () => {
      const ngoc = uniqueEmail('ngoc.bui');
      const tam = uniqueEmail('tam.vo');
      const res = await invite(a.admin.cookie, {
        emails: [ngoc, tam],
        role: 'member',
        departmentId: a.departmentId,
      });
      expect(res.statusCode).toBe(201);
      const invited = res.json().invited as { id: string; email: string }[];
      expect(invited.map((row) => row.email)).toEqual([ngoc, tam]);
      for (const email of [ngoc, tam]) {
        const mail = [...t.sent].reverse().find((item) => item.to === email);
        expect(mail?.subject).toContain('Gốm An Phú');
        expect(mail?.text).toContain(`${WEB_ORIGIN}/invite#token=`);
      }
      const list = (await call(t.app, 'GET', '/api/invitations', a.admin.cookie)).json()
        .invitations;
      for (const { id } of invited) {
        expect(list.find((row: { id: string }) => row.id === id)).toMatchObject({
          state: 'pending',
          role: 'member',
        });
      }
      const events = (await auditEventsOf(harness, a.companyId)).filter(
        (e) => e.action === 'invitation.created',
      );
      expect(events.map((e) => e.target_id)).toEqual(
        expect.arrayContaining(invited.map((row) => row.id)),
      );
    });

    it('Lời mời không ghi email: the AuditEvent has the id but no email or token', async () => {
      const email = uniqueEmail('audit');
      const { id, token } = await inviteOne(email);
      const event = (await auditEventsOf(harness, a.companyId)).find((e) => e.target_id === id);
      expect(event).toBeDefined();
      const text = JSON.stringify(await auditEventsOf(harness, a.companyId));
      expect(text).not.toContain(email);
      expect(text).not.toContain(token);
      // Only the hash is stored.
      const stored = await sqlIn(
        harness,
        a.companyId,
        'select token_hash from invitations where id = $1',
        [id],
      );
      expect(Buffer.from(stored[0].token_hash).toString()).not.toContain(token);
    });

    it('Một email sai định dạng → 400 naming it, no invitation created', async () => {
      const good = uniqueEmail('good');
      const res = await invite(a.owner.cookie, {
        emails: [good, 'thu@gomanphu'],
        role: 'member',
        departmentId: a.departmentId,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.details).toEqual([{ path: 'emails.1', message: 'email_invalid' }]);
      expect(t.sent.some((mail) => mail.to === good)).toBe(false);
    });

    it('Email đã là thành viên hoặc đang được mời: reported, the others still invited', async () => {
      const pending = uniqueEmail('pending');
      await inviteOne(pending);
      const fresh = uniqueEmail('fresh');
      const res = await invite(a.admin.cookie, {
        emails: [a.member.email, pending, fresh],
        role: 'member',
        departmentId: a.departmentId,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().invited.map((row: { email: string }) => row.email)).toEqual([fresh]);
      expect(res.json().skipped).toEqual([
        { email: a.member.email, reason: 'already_member' },
        { email: pending, reason: 'already_invited' },
      ]);
    });

    it('an expired invitation for the same email is replaced', async () => {
      const email = uniqueEmail('again');
      const first = await inviteOne(email);
      await expire(a.companyId, first.id);
      const second = await inviteOne(email);
      expect(second.id).not.toBe(first.id);
      expect((await preview(first.token)).statusCode).toBe(410);
      expect((await preview(second.token)).statusCode).toBe(200);
    });

    it.each(['manager', 'member'] as const)(
      '%s cannot invite → 403 + access.denied',
      async (who) => {
        const email = uniqueEmail('nope');
        const res = await invite(a[who].cookie, {
          emails: [email],
          role: 'member',
          departmentId: a.departmentId,
        });
        expect(res.statusCode).toBe(403);
        expect(t.sent.some((mail) => mail.to === email)).toBe(false);
        expect(await lastAudit(a.companyId, 'access.denied')).toMatchObject({
          actor_member_id: a[who].memberId,
        });
      },
    );
  });

  describe('Phải xác minh email trước khi mời', () => {
    it('Owner chưa xác minh email → 403 EMAIL_NOT_VERIFIED, nothing created', async () => {
      const fresh = await signUp(t.app, { companyName: 'Chưa xác minh' });
      const dept = await createDepartment(t.app, fresh.cookie, 'Kinh doanh');
      const email = uniqueEmail('x');
      const res = await invite(fresh.cookie, {
        emails: [email],
        role: 'member',
        departmentId: dept,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('EMAIL_NOT_VERIFIED');
      expect(t.sent.some((mail) => mail.to === email)).toBe(false);
    });
  });

  describe('Luật vai trò khi mời', () => {
    it.each(['admin', 'owner'])('Admin mời %s → 403, nothing created', async (role) => {
      const email = uniqueEmail('adm');
      const res = await invite(a.admin.cookie, { emails: [email], role });
      expect(res.statusCode).toBe(403);
      expect(t.sent.some((mail) => mail.to === email)).toBe(false);
    });

    it('Owner may invite an Admin without a department', async () => {
      const res = await invite(a.owner.cookie, { emails: [uniqueEmail('admin')], role: 'admin' });
      expect(res.statusCode).toBe(201);
    });

    it('Nhân viên không có phòng → 400 naming departmentId', async () => {
      const res = await invite(a.owner.cookie, { emails: [uniqueEmail('m')], role: 'member' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.details).toEqual([
        { path: 'departmentId', message: 'department_required' },
      ]);
    });

    it('Phòng ban của công ty khác → refused like a missing department', async () => {
      const res = await invite(a.admin.cookie, {
        emails: [uniqueEmail('m')],
        role: 'member',
        departmentId: b.departmentId,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.details).toEqual([
        { path: 'departmentId', message: 'department_not_found' },
      ]);
    });

    it('Phòng đã có trưởng phòng → 409 DEPARTMENT_HAS_HEAD', async () => {
      const res = await invite(a.admin.cookie, {
        emails: [uniqueEmail('lead')],
        role: 'manager',
        departmentId: a.departmentId,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('DEPARTMENT_HAS_HEAD');
    });

    it('a pending Manager invitation also counts as the head', async () => {
      const dept = await createDepartment(t.app, a.owner.cookie, `Kho ${randomUUID().slice(0, 6)}`);
      await inviteOne(uniqueEmail('lead1'), 'manager', dept);
      const res = await invite(a.owner.cookie, {
        emails: [uniqueEmail('lead2')],
        role: 'manager',
        departmentId: dept,
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe('Hạn, gửi lại và huỷ lời mời', () => {
    it('Gửi lại lời mời hết hạn: new email, new link works 7 more days, old link dead', async () => {
      const email = uniqueEmail('resend');
      const { id, token: oldToken } = await inviteOne(email);
      await expire(a.companyId, id);
      const res = await call(t.app, 'POST', `/api/invitations/${id}/resend`, a.admin.cookie);
      expect(res.statusCode).toBe(200);
      const newToken = invitationToken(t.sent, email);
      expect(newToken).not.toBe(oldToken);
      expect((await preview(oldToken)).statusCode).toBe(410);
      const fresh = await preview(newToken);
      expect(fresh.statusCode).toBe(200);
      const days = (new Date(fresh.json().expiresAt).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThanOrEqual(7);
      expect(await lastAudit(a.companyId, 'invitation.resent')).toMatchObject({ target_id: id });
    });

    it('Huỷ lời mời: link dead, no longer pending, AuditEvent', async () => {
      const { id, token } = await inviteOne(uniqueEmail('cancel'));
      const res = await call(t.app, 'POST', `/api/invitations/${id}/cancel`, a.owner.cookie);
      expect(res.statusCode).toBe(200);
      expect((await preview(token)).json().error.code).toBe('INVITATION_INVALID');
      const list = (await call(t.app, 'GET', '/api/invitations', a.owner.cookie)).json()
        .invitations;
      expect(list.map((row: { id: string }) => row.id)).not.toContain(id);
      expect(await lastAudit(a.companyId, 'invitation.cancelled')).toMatchObject({ target_id: id });
    });

    it('Admin cannot resend or cancel an Admin / Owner invitation → 403', async () => {
      const res = await invite(a.owner.cookie, { emails: [uniqueEmail('a2')], role: 'admin' });
      const id = res.json().invited[0].id;
      expect(
        (await call(t.app, 'POST', `/api/invitations/${id}/resend`, a.admin.cookie)).statusCode,
      ).toBe(403);
      expect(
        (await call(t.app, 'POST', `/api/invitations/${id}/cancel`, a.admin.cookie)).statusCode,
      ).toBe(403);
    });

    it('an unverified Admin cannot resend', async () => {
      const { id } = await inviteOne(uniqueEmail('rv'));
      await harness.database.pool.query(
        'update auth.users set email_verified = false where id = $1',
        [a.admin.userId],
      );
      const res = await call(t.app, 'POST', `/api/invitations/${id}/resend`, a.admin.cookie);
      await harness.database.pool.query(
        'update auth.users set email_verified = true where id = $1',
        [a.admin.userId],
      );
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('EMAIL_NOT_VERIFIED');
    });
  });

  describe('Xem lời mời', () => {
    it('Owner thấy lời mời đang chờ: state pending with its expiry', async () => {
      const { id } = await inviteOne(uniqueEmail('five'));
      await sqlIn(
        harness,
        a.companyId,
        "update invitations set expires_at = now() + interval '5 days' where id = $1",
        [id],
      );
      const row = (await call(t.app, 'GET', '/api/invitations', a.owner.cookie))
        .json()
        .invitations.find((item: { id: string }) => item.id === id);
      expect(row.state).toBe('pending');
      expect(Math.round((new Date(row.expiresAt).getTime() - Date.now()) / 86_400_000)).toBe(5);
    });

    it('an expired one is listed as expired, and ?state filters', async () => {
      const { id } = await inviteOne(uniqueEmail('old'));
      await expire(a.companyId, id);
      const expired = (
        await call(t.app, 'GET', '/api/invitations?state=expired', a.owner.cookie)
      ).json().invitations;
      expect(expired.map((row: { id: string }) => row.id)).toContain(id);
      expect(expired.every((row: { state: string }) => row.state === 'expired')).toBe(true);
    });

    it.each(['manager', 'member'] as const)('%s cannot list invitations → 403', async (who) => {
      expect((await call(t.app, 'GET', '/api/invitations', a[who].cookie)).statusCode).toBe(403);
    });

    it('Không thấy lời mời công ty khác', async () => {
      const email = uniqueEmail('b-only');
      await invite(b.owner.cookie, {
        emails: [email],
        role: 'member',
        departmentId: b.departmentId,
      });
      const body = (await call(t.app, 'GET', '/api/invitations', a.owner.cookie)).body;
      expect(body).not.toContain(email);
    });
  });

  describe('Mở link lời mời', () => {
    it('Link còn hạn: company, inviter, role, department and email', async () => {
      const email = uniqueEmail('open');
      const { token } = await inviteOne(email);
      const res = await preview(token);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        companyName: 'Gốm An Phú',
        inviterName: 'Trần Minh Đức',
        email,
        role: 'member',
        departmentName: 'Kinh doanh',
      });
    });

    it('Link hết hạn → 410 INVITATION_EXPIRED without company information', async () => {
      const { id, token } = await inviteOne(uniqueEmail('exp'));
      await expire(a.companyId, id);
      const res = await preview(token);
      expect(res.statusCode).toBe(410);
      expect(res.json().error.code).toBe('INVITATION_EXPIRED');
      expect(res.body).not.toContain('Gốm An Phú');
    });

    it('Token sai → 410 INVITATION_INVALID', async () => {
      const res = await preview('this-token-does-not-exist');
      expect(res.statusCode).toBe(410);
      expect(res.json().error.code).toBe('INVITATION_INVALID');
    });
  });

  describe('Nhận lời mời bằng mật khẩu', () => {
    it('Nhận lời mời thành công: Manager of Kinh doanh, signed in, email verified, link used once', async () => {
      const dept = await createDepartment(t.app, a.owner.cookie, `KD ${randomUUID().slice(0, 6)}`);
      const email = uniqueEmail('lan');
      const { id, token } = await inviteOne(email, 'manager', dept);
      const res = await accept({ token, name: 'Nguyễn Thị Lan', password: STRONG_PASSWORD });
      expect(res.statusCode).toBe(201);
      const cookie = cookieHeader(res);
      const me = (await get(t.app, '/api/me', cookie)).json();
      expect(me.user).toMatchObject({ email, emailVerified: true, name: 'Nguyễn Thị Lan' });
      expect(me.member.role).toBe('manager');
      expect(me.company.id).toBe(a.companyId);
      expect(await memberRow(harness, a.companyId, me.member.id)).toMatchObject({
        department_id: dept,
      });
      // No verification email was sent for this account.
      expect(
        t.sent.filter((mail) => mail.to === email).map((mail) => mail.subject),
      ).not.toContainEqual(expect.stringContaining('Xác minh'));
      expect((await accept({ token, name: 'X', password: STRONG_PASSWORD })).statusCode).toBe(410);
      expect(await lastAudit(a.companyId, 'invitation.accepted')).toMatchObject({
        actor_member_id: me.member.id,
        target_id: id,
      });
    });

    it('Mật khẩu quá phổ biến → 400, the invitation still works', async () => {
      const { token } = await inviteOne(uniqueEmail('weak'));
      const res = await accept({ token, name: 'Bình', password: '1234567890' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.details).toEqual([{ path: 'password', message: 'password_common' }]);
      expect((await preview(token)).statusCode).toBe(200);
    });

    it('Email đã thuộc công ty khác → 409 ALREADY_IN_COMPANY, no new member', async () => {
      const { token } = await inviteOne(b.member.email);
      const res = await accept({ token, name: 'Việt', password: STRONG_PASSWORD });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('ALREADY_IN_COMPANY');
      expect(await memberRow(harness, b.companyId, b.member.memberId)).toMatchObject({
        role: 'member',
      });
    });

    it('an existing account without a company → 409 EMAIL_TAKEN (sign in, then reopen)', async () => {
      const email = uniqueEmail('solo');
      await t.app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: WEB_ORIGIN },
        payload: { name: 'Solo', email, password: STRONG_PASSWORD },
      });
      const { token } = await inviteOne(email);
      const res = await accept({ token, name: 'Solo', password: STRONG_PASSWORD });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('EMAIL_TAKEN');
    });

    it.each([
      [
        'cancelled',
        async (id: string) => call(t.app, 'POST', `/api/invitations/${id}/cancel`, a.owner.cookie),
      ],
      ['expired', async (id: string) => expire(a.companyId, id)],
    ] as const)('a %s invitation cannot be accepted (410)', async (_label, spoil) => {
      const { id, token } = await inviteOne(uniqueEmail('spoilt'));
      await spoil(id);
      const res = await accept({ token, name: 'X', password: STRONG_PASSWORD });
      expect(res.statusCode).toBe(410);
    });
  });

  describe('Nhận lời mời bằng Google hoặc tài khoản sẵn có', () => {
    async function accountWithoutCompany(email: string) {
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: WEB_ORIGIN },
        payload: { name: 'Google Ngọc', email, password: STRONG_PASSWORD },
      });
      return cookieHeader(res);
    }

    it('cùng email (signed in, no company): joins without a password, email verified', async () => {
      const email = uniqueEmail('google');
      const cookie = await accountWithoutCompany(email);
      const { token } = await inviteOne(email);
      const res = await accept({ token }, cookie);
      expect(res.statusCode).toBe(201);
      const me = (await get(t.app, '/api/me', cookie)).json();
      expect(me.member.role).toBe('member');
      expect(me.company.id).toBe(a.companyId);
      expect(me.user.emailVerified).toBe(true);
    });

    it('khác email → 403 INVITATION_EMAIL_MISMATCH, invitation still valid', async () => {
      const cookie = await accountWithoutCompany(uniqueEmail('other'));
      const { token } = await inviteOne(uniqueEmail('target'));
      const res = await accept({ token }, cookie);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('INVITATION_EMAIL_MISMATCH');
      expect((await preview(token)).statusCode).toBe(200);
    });

    it('a signed-in member of another company → 409 ALREADY_IN_COMPANY', async () => {
      const { token } = await inviteOne(b.owner.email);
      const res = await accept({ token }, b.owner.cookie);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('ALREADY_IN_COMPANY');
    });

    it('signed out without name / password → 400 asking for both', async () => {
      const { token } = await inviteOne(uniqueEmail('blank'));
      const res = await accept({ token });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('Giới hạn thử link lời mời', () => {
    it('Dò token lời mời: over the per-IP limit → 429 (preview and accept)', async () => {
      const limited = makeApp(harness, { invitationLimit: { max: 3, windowMs: 60_000 } });
      try {
        const codes: number[] = [];
        for (let i = 0; i < 5; i += 1) {
          const res = await limited.app.inject({
            method: 'POST',
            url: '/api/invitations/preview',
            headers: { origin: WEB_ORIGIN },
            payload: { token: `guess-${i}` },
          });
          codes.push(res.statusCode);
        }
        expect(codes).toEqual([410, 410, 410, 429, 429]);
        const acceptRes = await limited.app.inject({
          method: 'POST',
          url: '/api/invitations/accept',
          headers: { origin: WEB_ORIGIN },
          payload: { token: 'guess' },
        });
        expect(acceptRes.statusCode).toBe(429);
      } finally {
        await limited.app.close();
      }
    });
  });

  describe('tenant isolation on every invitation route', () => {
    it.each(['resend', 'cancel'])(
      '%s on company B’s invitation from A → 404, B unchanged',
      async (action) => {
        const email = uniqueEmail('victim');
        const res = await invite(b.owner.cookie, {
          emails: [email],
          role: 'member',
          departmentId: b.departmentId,
        });
        const id = res.json().invited[0].id;
        const token = invitationToken(t.sent, email);
        const attack = await call(
          t.app,
          'POST',
          `/api/invitations/${id}/${action}`,
          a.owner.cookie,
        );
        expect(attack.statusCode).toBe(404);
        expect(await lastAudit(a.companyId, 'access.not_found')).toMatchObject({
          target_type: 'invitation',
          target_id: id,
        });
        expect((await preview(token)).statusCode).toBe(200);
      },
    );

    it('a malformed invitation id → 404', async () => {
      expect(
        (await call(t.app, 'POST', '/api/invitations/x/cancel', a.owner.cookie)).statusCode,
      ).toBe(404);
    });

    it('invitation emails and tokens never reach the log', async () => {
      const email = uniqueEmail('logcheck');
      const { token } = await inviteOne(email);
      await preview(token);
      const logs = t.logs();
      expect(logs).not.toContain(token);
      expect(logs).not.toContain(email);
    });
  });
});
