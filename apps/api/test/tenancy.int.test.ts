import { randomUUID } from 'node:crypto';
import { departments, members, withCompany } from '@dw/db';
import { eq } from '@dw/db/drizzle';
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

type Tenant = { companyId: string; ownerCookie: string; memberCookie: string; memberId: string };

describe('companies and members (specs company-signup, tenant-isolation, access-control)', () => {
  let harness: Harness;
  let t: TestApp;
  let a: Tenant;
  let b: Tenant;

  /** A company with an Owner and a Nhân viên (role member), each signed in. */
  async function seedTenant(name: string): Promise<Tenant> {
    const owner = await signUp(t.app, { companyName: name });
    const companyId = owner.companyId ?? '';
    // The member joins through 1b invites later; here we attach the account directly.
    const staffEmail = uniqueEmail('staff');
    const account = await t.app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: WEB_ORIGIN },
      payload: { name: 'Trần Bình', email: staffEmail, password: STRONG_PASSWORD },
    });
    const userId = account.json().user.id as string;
    const memberId = await withCompany(harness.database, companyId, async (tx) => {
      // A Nhân viên must belong to a department (change 1b, 0.2 #036).
      const [dept] = await tx
        .insert(departments)
        .values({ companyId, name: 'Kinh doanh' })
        .returning({ id: departments.id });
      const [row] = await tx
        .insert(members)
        .values({ companyId, userId, role: 'member', departmentId: dept?.id ?? null })
        .returning({ id: members.id });
      return row?.id ?? '';
    });
    const memberCookie = cookieHeader(await signIn(t.app, staffEmail));
    return { companyId, ownerCookie: owner.cookie, memberCookie, memberId };
  }

  const setRole = (tenant: Tenant, role: 'admin' | 'member') =>
    withCompany(harness.database, tenant.companyId, (tx) =>
      tx.update(members).set({ role }).where(eq(members.id, tenant.memberId)),
    );

  const patchCompany = (cookie: string, payload: unknown) =>
    t.app.inject({
      method: 'PATCH',
      url: '/api/company',
      headers: { origin: WEB_ORIGIN, cookie },
      payload: payload as object,
    });

  beforeAll(async () => {
    harness = await startHarness();
    t = makeApp(harness);
    a = await seedTenant('Công ty A');
    b = await seedTenant('Công ty B');
  });

  afterAll(async () => {
    await t?.app.close();
    await harness?.stop();
  });

  describe('POST /api/signup', () => {
    it('creates the company, makes the user Owner, signs in and logs company.created', async () => {
      const { companyId, cookie } = await signUp(t.app, { companyName: 'Gốm An Phú' });
      const me = (await get(t.app, '/api/me', cookie)).json();
      expect(me.company).toMatchObject({ id: companyId, name: 'Gốm An Phú', contactPhone: null });
      expect(me.member.role).toBe('owner');
      const events = await auditEventsOf(harness, companyId ?? '');
      expect(events[0]).toMatchObject({
        action: 'company.created',
        actor_member_id: me.member.id,
        target_type: 'company',
        target_id: companyId,
      });
    });

    it('works without a phone and stores one when given', async () => {
      const { cookie } = await signUp(t.app, { phone: '0912 345 678' });
      expect((await get(t.app, '/api/company', cookie)).json().contactPhone).toBe('0912 345 678');
    });

    it('an email that already has an account → 409, no new company', async () => {
      const { email } = await signUp(t.app);
      const before = await harness.owner.pool.query('select count(*)::int as n from members');
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/signup',
        headers: { origin: WEB_ORIGIN },
        payload: { companyName: 'Khác', name: 'X', email, password: STRONG_PASSWORD },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('EMAIL_TAKEN');
      const after = await harness.owner.pool.query('select count(*)::int as n from members');
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it('an empty company name → 400 naming companyName', async () => {
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/signup',
        headers: { origin: WEB_ORIGIN },
        payload: { companyName: ' ', name: 'X', email: uniqueEmail(), password: STRONG_PASSWORD },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.details).toEqual([{ path: 'companyName', message: 'required' }]);
    });

    it.each([
      ['abcdefghi', 'password_too_short'],
      ['1234567890', 'password_common'],
    ])('password %s → 400 %s', async (password, code) => {
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/signup',
        headers: { origin: WEB_ORIGIN },
        payload: { companyName: 'X', name: 'X', email: uniqueEmail(), password },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.details).toEqual([{ path: 'password', message: code }]);
    });

    it('a failure after the account exists leaves the user signed in without a company (409 NO_COMPANY)', async () => {
      const failing = makeApp(harness, {
        createCompany: async () => {
          throw new Error('simulated failure');
        },
      });
      try {
        const res = await failing.app.inject({
          method: 'POST',
          url: '/api/signup',
          headers: { origin: WEB_ORIGIN },
          payload: { companyName: 'X', name: 'X', email: uniqueEmail(), password: STRONG_PASSWORD },
        });
        expect(res.statusCode).toBe(201);
        expect(res.json()).toEqual({ companyId: null });
        const cookie = cookieHeader(res);
        const me = (await get(t.app, '/api/me', cookie)).json();
        expect(me).toMatchObject({ member: null, company: null });
        const company = await get(t.app, '/api/company', cookie);
        expect(company.statusCode).toBe(409);
        expect(company.json().error.code).toBe('NO_COMPANY');
      } finally {
        await failing.app.close();
      }
    });
  });

  describe('CSRF origin check and sign-up limit', () => {
    it('state-changing requests without a trusted Origin are refused', async () => {
      const noOrigin = await t.app.inject({
        method: 'PATCH',
        url: '/api/company',
        headers: { cookie: a.ownerCookie },
        payload: { name: 'CSRF' },
      });
      expect(noOrigin.statusCode).toBe(403);
      expect(noOrigin.json().error.code).toBe('INVALID_ORIGIN');
      const evil = await t.app.inject({
        method: 'POST',
        url: '/api/signup',
        headers: { origin: 'https://evil.example' },
        payload: { companyName: 'X', name: 'X', email: uniqueEmail(), password: STRONG_PASSWORD },
      });
      expect(evil.statusCode).toBe(403);
      expect((await get(t.app, '/api/company', a.ownerCookie)).json().name).toBe('Công ty A');
    });

    it('POST /api/signup is limited per IP', async () => {
      const limited = makeApp(harness, { signupLimit: { max: 2, windowMs: 60_000 } });
      try {
        await signUp(limited.app);
        await signUp(limited.app);
        const res = await limited.app.inject({
          method: 'POST',
          url: '/api/signup',
          headers: { origin: WEB_ORIGIN },
          payload: { companyName: 'X', name: 'X', email: uniqueEmail(), password: STRONG_PASSWORD },
        });
        expect(res.statusCode).toBe(429);
      } finally {
        await limited.app.close();
      }
    });
  });

  describe('POST /api/companies (after Google sign-in)', () => {
    async function accountWithoutCompany() {
      const email = uniqueEmail('google');
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: WEB_ORIGIN },
        payload: { name: 'Lê Chi', email, password: STRONG_PASSWORD },
      });
      return cookieHeader(res);
    }

    it('business APIs answer 409 NO_COMPANY until the company exists, then the user is Owner', async () => {
      const cookie = await accountWithoutCompany();
      expect((await get(t.app, '/api/company', cookie)).json().error.code).toBe('NO_COMPANY');
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/companies',
        headers: { origin: WEB_ORIGIN, cookie },
        payload: { name: 'Gốm Chi' },
      });
      expect(res.statusCode).toBe(201);
      const me = (await get(t.app, '/api/me', cookie)).json();
      expect(me).toMatchObject({ member: { role: 'owner' }, company: { name: 'Gốm Chi' } });
    });

    it('a user who already has a company cannot create another', async () => {
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/companies',
        headers: { origin: WEB_ORIGIN, cookie: a.ownerCookie },
        payload: { name: 'Thêm' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('ALREADY_IN_COMPANY');
    });

    it('two concurrent creations for one user → exactly one company', async () => {
      const cookie = await accountWithoutCompany();
      const results = await Promise.all(
        [1, 2].map((n) =>
          t.app.inject({
            method: 'POST',
            url: '/api/companies',
            headers: { origin: WEB_ORIGIN, cookie },
            payload: { name: `Song song ${n}` },
          }),
        ),
      );
      expect(results.map((res) => res.statusCode).sort()).toEqual([201, 409]);
    });

    it('without a session → 401', async () => {
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/companies',
        headers: { origin: WEB_ORIGIN },
        payload: { name: 'X' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/config/public', () => {
    it('reports Google as disabled when it is not configured', async () => {
      expect((await get(t.app, '/api/config/public')).json()).toEqual({ googleEnabled: false });
    });
  });

  describe('GET /api/me', () => {
    it('company A owner sees only company A', async () => {
      const res = await get(t.app, '/api/me', a.ownerCookie);
      expect(res.json().company.id).toBe(a.companyId);
      expect(res.body).not.toContain(b.companyId);
      expect(res.body).not.toContain('Công ty B');
    });
  });

  describe('GET|PATCH /api/company', () => {
    it('every member can read the company name', async () => {
      const res = await get(t.app, '/api/company', a.memberCookie);
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Công ty A');
    });

    it('Owner renames the company; AuditEvent records the field name only', async () => {
      const res = await patchCompany(a.ownerCookie, { name: 'Gốm An Phú Bát Tràng' });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Gốm An Phú Bát Tràng');
      const last = (await auditEventsOf(harness, a.companyId)).at(-1);
      expect(last).toMatchObject({ action: 'company.updated', fields: ['name'] });
      await patchCompany(a.ownerCookie, { name: 'Công ty A' });
    });

    it('Admin may update the company', async () => {
      await setRole(a, 'admin');
      try {
        const res = await patchCompany(a.memberCookie, { name: 'Công ty A (Admin)' });
        expect(res.statusCode).toBe(200);
        const last = (await auditEventsOf(harness, a.companyId)).at(-1);
        expect(last).toMatchObject({ action: 'company.updated', actor_member_id: a.memberId });
      } finally {
        await setRole(a, 'member');
        await patchCompany(a.ownerCookie, { name: 'Công ty A' });
      }
    });

    it('Nhân viên gets 403, the name stays, and access.denied is logged', async () => {
      const res = await patchCompany(a.memberCookie, { name: 'Đổi trộm' });
      expect(res.statusCode).toBe(403);
      expect((await get(t.app, '/api/company', a.ownerCookie)).json().name).toBe('Công ty A');
      const last = (await auditEventsOf(harness, a.companyId)).at(-1);
      expect(last).toMatchObject({
        action: 'access.denied',
        actor_member_id: a.memberId,
        target_id: 'company.update',
      });
    });

    it('a company id of B in the body cannot change company B', async () => {
      for (const payload of [
        { name: 'Bị đổi', id: b.companyId },
        { name: 'Bị đổi', companyId: b.companyId },
      ]) {
        const res = await patchCompany(a.ownerCookie, payload);
        expect(res.statusCode).toBe(400);
      }
      expect((await get(t.app, '/api/company', b.ownerCookie)).json().name).toBe('Công ty B');
    });

    it('changing the phone logs the field name, never the old or new number', async () => {
      await patchCompany(a.ownerCookie, { contactPhone: '0901 111 222' });
      await patchCompany(a.ownerCookie, { contactPhone: '0903 333 444' });
      const events = await auditEventsOf(harness, a.companyId);
      expect(events.at(-1)).toMatchObject({ action: 'company.updated', fields: ['contact_phone'] });
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain('0901');
      expect(serialized).not.toContain('0903');
    });

    it("company B cannot read company A's audit events", async () => {
      const bEvents = await auditEventsOf(harness, b.companyId);
      expect(JSON.stringify(bEvents)).not.toContain(a.companyId);
    });
  });

  describe('GET /api/members/:id', () => {
    it('reads a member of the own company → 200', async () => {
      const res = await get(t.app, `/api/members/${a.memberId}`, a.ownerCookie);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: a.memberId, name: 'Trần Bình', role: 'member' });
    });

    it('an id of company B → the same 404 as a missing id, plus access.not_found in A', async () => {
      const foreign = await get(t.app, `/api/members/${b.memberId}`, a.ownerCookie);
      const missing = await get(t.app, `/api/members/${randomUUID()}`, a.ownerCookie);
      expect(foreign.statusCode).toBe(404);
      expect(foreign.body).toBe(missing.body);
      expect(foreign.body).not.toContain('Trần Bình');
      const events = await auditEventsOf(harness, a.companyId);
      expect(events).toContainEqual(
        expect.objectContaining({
          action: 'access.not_found',
          target_type: 'member',
          target_id: b.memberId,
        }),
      );
      const bEvents = await auditEventsOf(harness, b.companyId);
      expect(bEvents.map((event) => event.action)).not.toContain('access.not_found');
    });

    it('a malformed id is a plain 404', async () => {
      const res = await get(t.app, '/api/members/not-a-uuid', a.ownerCookie);
      expect(res.statusCode).toBe(404);
    });
  });
});
