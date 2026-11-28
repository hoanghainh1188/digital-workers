import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditEventsOf,
  get,
  type Harness,
  makeApp,
  signIn,
  startHarness,
  type TestApp,
} from './support/harness.ts';
import {
  addPerson,
  call,
  createDepartment,
  memberRow,
  type OrgTenant,
  seedOrg,
  sqlIn,
} from './support/org.ts';

describe('member management (spec member-management, authentication: locked accounts)', () => {
  let harness: Harness;
  let t: TestApp;
  let a: OrgTenant;
  let b: OrgTenant;
  let keToan: string;

  const lastAudit = async (companyId: string, action: string) =>
    (await auditEventsOf(harness, companyId)).filter((event) => event.action === action).at(-1);
  const listMembers = (cookie: string, query = '') =>
    call(t.app, 'GET', `/api/members${query}`, cookie);
  const patch = (cookie: string, id: string, body: unknown) =>
    call(t.app, 'PATCH', `/api/members/${id}`, cookie, body);

  beforeAll(async () => {
    harness = await startHarness();
    t = makeApp(harness);
    a = await seedOrg(t, harness, 'Gốm An Phú');
    b = await seedOrg(t, harness, 'Công ty B');
    keToan = await createDepartment(t.app, a.owner.cookie, 'Kế toán');
  });

  afterAll(async () => {
    await t?.app.close();
    await harness?.stop();
  });

  describe('Xem danh sách người dùng', () => {
    it('Owner sees everyone in the company with role, department, status and activity', async () => {
      const res = await listMembers(a.owner.cookie);
      expect(res.statusCode).toBe(200);
      const rows = res.json().members;
      expect(rows.map((row: { id: string }) => row.id)).toEqual(
        expect.arrayContaining([
          a.owner.memberId,
          a.admin.memberId,
          a.manager.memberId,
          a.member.memberId,
        ]),
      );
      const lan = rows.find((row: { id: string }) => row.id === a.manager.memberId);
      expect(lan).toMatchObject({
        name: 'Nguyễn Thị Lan',
        role: 'manager',
        departmentId: a.departmentId,
        departmentName: 'Kinh doanh',
        status: 'active',
      });
      // The Owner has been making requests: "Hoạt động" is filled in (design D6).
      expect(
        rows.find((row: { id: string }) => row.id === a.owner.memberId).lastSeenAt,
      ).not.toBeNull();
    });

    it('Trưởng phòng xem phòng mình: only Kinh doanh, whatever the query asks', async () => {
      const other = await addPerson(t, harness, a.companyId, 'member', keToan);
      const res = await listMembers(a.manager.cookie, `?department=${keToan}`);
      expect(res.statusCode).toBe(200);
      const rows = res.json().members as { id: string; departmentId: string }[];
      expect(rows.every((row) => row.departmentId === a.departmentId)).toBe(true);
      expect(rows.map((row) => row.id)).not.toContain(other.memberId);
      expect(rows.map((row) => row.id)).toContain(a.member.memberId);
    });

    it('Nhân viên không xem được → 403 + access.denied', async () => {
      const res = await listMembers(a.member.cookie);
      expect(res.statusCode).toBe(403);
      expect(await lastAudit(a.companyId, 'access.denied')).toMatchObject({
        actor_member_id: a.member.memberId,
        target_id: 'member.list',
      });
    });

    it('Không thấy người công ty khác', async () => {
      const body = (await listMembers(a.owner.cookie)).body;
      for (const person of [b.owner, b.admin, b.manager, b.member]) {
        expect(body).not.toContain(person.memberId);
        expect(body).not.toContain(person.email);
      }
    });
  });

  describe('Lọc danh sách người dùng', () => {
    it('Lọc theo phòng và vai trò', async () => {
      const vy = await addPerson(t, harness, a.companyId, 'member', keToan, 'Lê Vy');
      const res = await listMembers(a.admin.cookie, `?department=${keToan}&role=member`);
      const rows = res.json().members as { id: string; role: string; departmentId: string }[];
      expect(rows.map((row) => row.id)).toContain(vy.memberId);
      expect(rows.every((row) => row.role === 'member' && row.departmentId === keToan)).toBe(true);
    });

    it('department=none lists people without a department; q matches name or email', async () => {
      const none = (await listMembers(a.owner.cookie, '?department=none')).json().members;
      expect(none.map((row: { id: string }) => row.id).sort()).toEqual(
        [a.owner.memberId, a.admin.memberId].sort(),
      );
      const byName = (
        await listMembers(a.owner.cookie, `?q=${encodeURIComponent('quốc anh')}`)
      ).json().members;
      expect(byName.map((row: { id: string }) => row.id)).toEqual([a.admin.memberId]);
      const byEmail = (
        await listMembers(a.owner.cookie, `?q=${encodeURIComponent(a.member.email.slice(0, 12))}`)
      ).json().members;
      expect(byEmail.map((row: { id: string }) => row.id)).toContain(a.member.memberId);
    });

    it('Không có kết quả → empty list; LIKE wildcards are literal', async () => {
      expect(
        (await listMembers(a.owner.cookie, `?q=${encodeURIComponent('kế toán trưởng')}`)).json()
          .members,
      ).toEqual([]);
      expect((await listMembers(a.owner.cookie, '?q=%25')).json().members).toEqual([]);
    });

    it('an invalid filter → 400', async () => {
      expect((await listMembers(a.owner.cookie, '?role=boss')).statusCode).toBe(400);
    });
  });

  describe('Chỉ Owner quản lý Owner và Admin', () => {
    it('Owner gán Admin → done + AuditEvent', async () => {
      const p = await addPerson(t, harness, a.companyId, 'member', a.departmentId);
      const res = await patch(a.owner.cookie, p.memberId, { role: 'admin' });
      expect(res.statusCode).toBe(200);
      expect(await memberRow(harness, a.companyId, p.memberId)).toMatchObject({ role: 'admin' });
      expect(await lastAudit(a.companyId, 'member.role_changed')).toMatchObject({
        actor_member_id: a.owner.memberId,
        target_id: p.memberId,
        fields: ['role'],
      });
    });

    it.each(['admin', 'owner'] as const)(
      'Admin gán %s → 403, role unchanged, access.denied',
      async (role) => {
        const p = await addPerson(t, harness, a.companyId, 'member', a.departmentId);
        const res = await patch(a.admin.cookie, p.memberId, { role });
        expect(res.statusCode).toBe(403);
        expect(await memberRow(harness, a.companyId, p.memberId)).toMatchObject({ role: 'member' });
        expect(await lastAudit(a.companyId, 'access.denied')).toMatchObject({
          actor_member_id: a.admin.memberId,
          target_id: p.memberId,
        });
      },
    );

    it('Admin cannot change, move or lock an Owner or another Admin', async () => {
      const otherAdmin = await addPerson(t, harness, a.companyId, 'admin', null);
      for (const target of [a.owner.memberId, otherAdmin.memberId]) {
        expect((await patch(a.admin.cookie, target, { departmentId: keToan })).statusCode).toBe(
          403,
        );
        expect(
          (await call(t.app, 'POST', `/api/members/${target}/lock`, a.admin.cookie)).statusCode,
        ).toBe(403);
      }
      expect(await memberRow(harness, a.companyId, a.owner.memberId)).toMatchObject({
        status: 'active',
      });
    });
  });

  describe('Luôn còn một Owner đang hoạt động', () => {
    it('Hạ vai trò Owner cuối cùng → 409 LAST_OWNER, role unchanged', async () => {
      const res = await patch(a.owner.cookie, a.owner.memberId, { role: 'admin' });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('LAST_OWNER');
      expect(await memberRow(harness, a.companyId, a.owner.memberId)).toMatchObject({
        role: 'owner',
      });
    });

    it('Có Owner khác thì được hạ', async () => {
      const c = await seedOrg(t, harness, 'Hai Owner');
      const second = await addPerson(t, harness, c.companyId, 'owner', null);
      const res = await patch(second.cookie, second.memberId, { role: 'admin' });
      expect(res.statusCode).toBe(200);
      expect(await memberRow(harness, c.companyId, second.memberId)).toMatchObject({
        role: 'admin',
      });
    });

    it('Hai Owner hạ vai trò nhau cùng lúc → at most one succeeds, one Owner stays', async () => {
      for (let round = 0; round < 3; round += 1) {
        const c = await seedOrg(t, harness, `Đua ${round}`);
        const second = await addPerson(t, harness, c.companyId, 'owner', null);
        const results = await Promise.all([
          patch(c.owner.cookie, second.memberId, { role: 'admin' }),
          patch(second.cookie, c.owner.memberId, { role: 'admin' }),
        ]);
        const codes = results.map((res) => res.statusCode).sort();
        // The loser is refused either as last Owner (409) or, if it was already
        // demoted when its request ran, as an Admin managing an Owner (403).
        expect(codes[0]).toBe(200);
        expect([403, 409]).toContain(codes[1]);
        const owners = await sqlIn(
          harness,
          c.companyId,
          "select count(*)::int as n from members where role = 'owner' and status = 'active'",
        );
        expect(owners[0].n).toBe(1);
      }
    });
  });

  describe('Đổi vai trò', () => {
    it('Nhân viên lên Trưởng phòng in a department without one', async () => {
      const p = await addPerson(t, harness, a.companyId, 'member', keToan);
      const res = await patch(a.admin.cookie, p.memberId, { role: 'manager' });
      expect(res.statusCode).toBe(200);
      const head = (await call(t.app, 'GET', '/api/departments', a.admin.cookie))
        .json()
        .departments.find((d: { id: string }) => d.id === keToan).head;
      expect(head.id).toBe(p.memberId);
    });

    it('Trưởng phòng when the department already has one → 409 DEPARTMENT_HAS_HEAD', async () => {
      const p = await addPerson(t, harness, a.companyId, 'member', a.departmentId);
      const res = await patch(a.admin.cookie, p.memberId, { role: 'manager' });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('DEPARTMENT_HAS_HEAD');
    });

    it('Admin xuống Nhân viên thiếu phòng → 400 asking for departmentId', async () => {
      const admin2 = await addPerson(t, harness, a.companyId, 'admin', null);
      const res = await patch(a.owner.cookie, admin2.memberId, { role: 'member' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.details).toEqual([
        { path: 'departmentId', message: 'department_required' },
      ]);
      expect(await memberRow(harness, a.companyId, admin2.memberId)).toMatchObject({
        role: 'admin',
      });
    });

    it('Đổi vai trò thành viên công ty khác → 404 + access.not_found, B unchanged', async () => {
      const res = await patch(a.owner.cookie, b.member.memberId, { role: 'admin' });
      expect(res.statusCode).toBe(404);
      expect(await lastAudit(a.companyId, 'access.not_found')).toMatchObject({
        target_type: 'member',
        target_id: b.member.memberId,
      });
      expect(await memberRow(harness, b.companyId, b.member.memberId)).toMatchObject({
        role: 'member',
      });
    });
  });

  describe('Chuyển phòng ban', () => {
    it('Chuyển Nhân viên Kinh doanh → Kế toán + AuditEvent member.moved', async () => {
      const p = await addPerson(t, harness, a.companyId, 'member', a.departmentId);
      const res = await patch(a.admin.cookie, p.memberId, { departmentId: keToan });
      expect(res.statusCode).toBe(200);
      expect(await memberRow(harness, a.companyId, p.memberId)).toMatchObject({
        department_id: keToan,
      });
      expect(await lastAudit(a.companyId, 'member.moved')).toMatchObject({
        target_id: p.memberId,
        fields: ['department'],
      });
    });

    it('Chuyển Trưởng phòng → Member of the new department; the old one has no head', async () => {
      const kho = await createDepartment(t.app, a.owner.cookie, `Kho ${randomUUID().slice(0, 6)}`);
      const lead = await addPerson(t, harness, a.companyId, 'manager', kho);
      const res = await patch(a.owner.cookie, lead.memberId, { departmentId: keToan });
      expect(res.statusCode).toBe(200);
      expect(await memberRow(harness, a.companyId, lead.memberId)).toMatchObject({
        role: 'member',
        department_id: keToan,
      });
      const depts = (await call(t.app, 'GET', '/api/departments', a.owner.cookie)).json()
        .departments;
      expect(depts.find((d: { id: string }) => d.id === kho).head).toBeNull();
    });

    it('Owner / Admin may have no department; a Member may not', async () => {
      const admin2 = await addPerson(t, harness, a.companyId, 'admin', keToan);
      expect(
        (await patch(a.owner.cookie, admin2.memberId, { departmentId: null })).statusCode,
      ).toBe(200);
      expect(
        (await patch(a.owner.cookie, a.member.memberId, { departmentId: null })).statusCode,
      ).toBe(400);
    });

    it('Chuyển sang phòng công ty khác → refused as not found, department unchanged', async () => {
      const p = await addPerson(t, harness, a.companyId, 'member', a.departmentId);
      const res = await patch(a.admin.cookie, p.memberId, { departmentId: b.departmentId });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.details).toEqual([
        { path: 'departmentId', message: 'department_not_found' },
      ]);
      expect(await memberRow(harness, a.companyId, p.memberId)).toMatchObject({
        department_id: a.departmentId,
      });
    });

    it('moving into an archived department is refused', async () => {
      const old = await createDepartment(t.app, a.owner.cookie, `Cũ ${randomUUID().slice(0, 6)}`);
      await call(t.app, 'POST', `/api/departments/${old}/archive`, a.owner.cookie);
      expect(
        (await patch(a.owner.cookie, a.member.memberId, { departmentId: old })).statusCode,
      ).toBe(400);
    });
  });

  describe('Khoá tài khoản', () => {
    it('Khoá người nghỉ việc: old session → 401, "Đã khoá" with date, AuditEvent', async () => {
      const quang = await addPerson(
        t,
        harness,
        a.companyId,
        'member',
        a.departmentId,
        'Phan Quang',
      );
      expect((await get(t.app, '/api/me', quang.cookie)).statusCode).toBe(200);
      const res = await call(t.app, 'POST', `/api/members/${quang.memberId}/lock`, a.admin.cookie);
      expect(res.statusCode).toBe(200);
      expect((await get(t.app, '/api/me', quang.cookie)).statusCode).toBe(401);
      const row = await memberRow(harness, a.companyId, quang.memberId);
      expect(row).toMatchObject({
        status: 'locked',
        role: 'member',
        department_id: a.departmentId,
      });
      expect(row?.locked_at).toBeInstanceOf(Date);
      expect(await lastAudit(a.companyId, 'member.locked')).toMatchObject({
        actor_member_id: a.admin.memberId,
        target_type: 'member',
        target_id: quang.memberId,
      });
    });

    it('Đăng nhập khi bị khoá: right password → 403 ACCOUNT_LOCKED and no session', async () => {
      const p = await addPerson(t, harness, a.companyId, 'member', a.departmentId);
      await call(t.app, 'POST', `/api/members/${p.memberId}/lock`, a.owner.cookie);
      const res = await signIn(t.app, p.email);
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('ACCOUNT_LOCKED');
      expect(res.cookies.find((cookie) => cookie.name.includes('session_token'))?.value ?? '').toBe(
        '',
      );
      const sessions = await harness.database.pool.query(
        'select count(*)::int as n from auth.sessions where user_id = $1',
        [p.userId],
      );
      expect(sessions.rows[0].n).toBe(0);
      // A wrong password still gets the usual 401 (nothing more is revealed).
      expect((await signIn(t.app, p.email, 'not the password at all')).statusCode).toBe(401);
    });

    it('Google khi bị khoá: any other way of creating a session is refused too', async () => {
      const p = await addPerson(t, harness, a.companyId, 'member', a.departmentId);
      await call(t.app, 'POST', `/api/members/${p.memberId}/lock`, a.owner.cookie);
      const context = await t.platform.auth.$context;
      // The Google callback ends in internalAdapter.createSession, like every sign-in.
      await expect(context.internalAdapter.createSession(p.userId)).rejects.toMatchObject({
        body: { code: 'ACCOUNT_LOCKED' },
      });
    });

    it('Tự khoá mình → 409 CANNOT_LOCK_SELF', async () => {
      const res = await call(
        t.app,
        'POST',
        `/api/members/${a.owner.memberId}/lock`,
        a.owner.cookie,
      );
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('CANNOT_LOCK_SELF');
      expect(await memberRow(harness, a.companyId, a.owner.memberId)).toMatchObject({
        status: 'active',
      });
    });

    it('Khoá thành viên công ty khác → 404, B still signed in, access.not_found', async () => {
      const res = await call(
        t.app,
        'POST',
        `/api/members/${b.member.memberId}/lock`,
        a.admin.cookie,
      );
      expect(res.statusCode).toBe(404);
      expect((await get(t.app, '/api/me', b.member.cookie)).statusCode).toBe(200);
      expect(await lastAudit(a.companyId, 'access.not_found')).toMatchObject({
        target_id: b.member.memberId,
      });
    });
  });

  describe('Mở khoá tài khoản', () => {
    it('Mở khoá: signs in again with the old password, same role and department', async () => {
      const quang = await addPerson(t, harness, a.companyId, 'member', keToan, 'Phan Quang');
      await call(t.app, 'POST', `/api/members/${quang.memberId}/lock`, a.owner.cookie);
      const res = await call(
        t.app,
        'POST',
        `/api/members/${quang.memberId}/unlock`,
        a.owner.cookie,
      );
      expect(res.statusCode).toBe(200);
      expect((await signIn(t.app, quang.email)).statusCode).toBe(200);
      expect(await memberRow(harness, a.companyId, quang.memberId)).toMatchObject({
        status: 'active',
        role: 'member',
        department_id: keToan,
        locked_at: null,
      });
      expect(await lastAudit(a.companyId, 'member.unlocked')).toMatchObject({
        target_id: quang.memberId,
      });
    });

    it('Trưởng phòng không mở khoá được → 403, still locked', async () => {
      const p = await addPerson(t, harness, a.companyId, 'member', a.departmentId);
      await call(t.app, 'POST', `/api/members/${p.memberId}/lock`, a.owner.cookie);
      const res = await call(t.app, 'POST', `/api/members/${p.memberId}/unlock`, a.manager.cookie);
      expect(res.statusCode).toBe(403);
      expect(await memberRow(harness, a.companyId, p.memberId)).toMatchObject({ status: 'locked' });
    });

    it('unlock from company A on company B’s member → 404', async () => {
      const res = await call(
        t.app,
        'POST',
        `/api/members/${b.member.memberId}/unlock`,
        a.owner.cookie,
      );
      expect(res.statusCode).toBe(404);
    });
  });

  describe('permissions on every member route', () => {
    it.each(['manager', 'member'] as const)(
      '%s cannot patch, lock or unlock → 403',
      async (who) => {
        const target = a.member.memberId;
        expect((await patch(a[who].cookie, target, { departmentId: keToan })).statusCode).toBe(403);
        expect(
          (await call(t.app, 'POST', `/api/members/${target}/lock`, a[who].cookie)).statusCode,
        ).toBe(403);
        expect(
          (await call(t.app, 'POST', `/api/members/${target}/unlock`, a[who].cookie)).statusCode,
        ).toBe(403);
      },
    );

    it('a company id in the body is rejected by the strict schema', async () => {
      const res = await patch(a.owner.cookie, a.member.memberId, {
        companyId: b.companyId,
        role: 'member',
      });
      expect(res.statusCode).toBe(400);
    });

    it('a malformed id → 404', async () => {
      expect((await patch(a.owner.cookie, 'x', { role: 'member' })).statusCode).toBe(404);
    });
  });
});
