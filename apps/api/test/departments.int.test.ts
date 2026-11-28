import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditEventsOf,
  type Harness,
  makeApp,
  startHarness,
  type TestApp,
  uniqueEmail,
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

describe('departments (spec departments)', () => {
  let harness: Harness;
  let t: TestApp;
  let a: OrgTenant;
  let b: OrgTenant;

  const list = async (cookie: string) =>
    (await call(t.app, 'GET', '/api/departments', cookie)).json();
  const lastAudit = async (companyId: string, action: string) =>
    (await auditEventsOf(harness, companyId)).filter((event) => event.action === action).at(-1);

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

  describe('Tạo phòng ban', () => {
    it('Admin tạo phòng ban "Kho vận" with a description → created + AuditEvent', async () => {
      const res = await call(t.app, 'POST', '/api/departments', a.admin.cookie, {
        name: 'Kho vận',
        description: 'Nhập hàng, xuất kho',
      });
      expect(res.statusCode).toBe(201);
      const { id } = res.json();
      const found = (await list(a.admin.cookie)).departments.find(
        (dept: { id: string }) => dept.id === id,
      );
      expect(found).toMatchObject({
        name: 'Kho vận',
        description: 'Nhập hàng, xuất kho',
        head: null,
      });
      expect(await lastAudit(a.companyId, 'department.created')).toMatchObject({
        actor_member_id: a.admin.memberId,
        target_type: 'department',
        target_id: id,
      });
    });

    it('Tên trùng (case-insensitive) → 400 naming the field', async () => {
      const res = await call(t.app, 'POST', '/api/departments', a.owner.cookie, {
        name: 'kinh DOANH',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.details).toEqual([
        { path: 'name', message: 'department_name_taken' },
      ]);
    });

    it.each(['manager', 'member'] as const)(
      '%s cannot create → 403, nothing created, access.denied',
      async (who) => {
        const before = (await list(a.owner.cookie)).departments.length;
        const res = await call(t.app, 'POST', '/api/departments', a[who].cookie, { name: 'Lậu' });
        expect(res.statusCode).toBe(403);
        expect((await list(a.owner.cookie)).departments.length).toBe(before);
        expect(await lastAudit(a.companyId, 'access.denied')).toMatchObject({
          actor_member_id: a[who].memberId,
          target_id: 'org.manage',
        });
      },
    );

    it('a head given at creation becomes Manager of the new department', async () => {
      const kinhDoanhMember = await addPerson(t, harness, a.companyId, 'member', a.departmentId);
      const res = await call(t.app, 'POST', '/api/departments', a.owner.cookie, {
        name: `Kho ${randomUUID().slice(0, 6)}`,
        headMemberId: kinhDoanhMember.memberId,
      });
      expect(res.statusCode).toBe(201);
      expect(await memberRow(harness, a.companyId, kinhDoanhMember.memberId)).toMatchObject({
        role: 'manager',
        department_id: res.json().id,
      });
    });

    it('a bad head at creation rolls the whole creation back', async () => {
      const name = `Không tạo ${randomUUID().slice(0, 6)}`;
      const res = await call(t.app, 'POST', '/api/departments', a.owner.cookie, {
        name,
        headMemberId: a.owner.memberId,
      });
      expect(res.statusCode).toBe(400);
      expect(
        (await list(a.owner.cookie)).departments.map((d: { name: string }) => d.name),
      ).not.toContain(name);
    });
  });

  describe('Sửa phòng ban', () => {
    it('Admin đổi tên "CSKH" → "Chăm sóc khách hàng" with AuditEvent fields [name]', async () => {
      const id = await createDepartment(t.app, a.owner.cookie, 'CSKH');
      const res = await call(t.app, 'PATCH', `/api/departments/${id}`, a.admin.cookie, {
        name: 'Chăm sóc khách hàng',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().changed).toEqual(['name']);
      expect(await lastAudit(a.companyId, 'department.updated')).toMatchObject({
        target_id: id,
        fields: ['name'],
      });
    });

    it('renaming to an existing name → 400', async () => {
      const id = await createDepartment(t.app, a.owner.cookie, `Tạm ${randomUUID().slice(0, 6)}`);
      const res = await call(t.app, 'PATCH', `/api/departments/${id}`, a.owner.cookie, {
        name: 'KINH DOANH',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('Một trưởng phòng mỗi phòng', () => {
    it('Chọn trưởng phòng là Owner → refused, department unchanged', async () => {
      const res = await call(t.app, 'PATCH', `/api/departments/${a.departmentId}`, a.admin.cookie, {
        headMemberId: a.owner.memberId,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.details).toEqual([
        { path: 'headMemberId', message: 'head_not_eligible' },
      ]);
      expect(await memberRow(harness, a.companyId, a.manager.memberId)).toMatchObject({
        role: 'manager',
      });
    });

    it('Bỏ trưởng phòng → the head becomes a Member of the same department', async () => {
      const id = await createDepartment(
        t.app,
        a.owner.cookie,
        `Kế toán ${randomUUID().slice(0, 6)}`,
      );
      const ha = await addPerson(t, harness, a.companyId, 'manager', id, 'Đỗ Thu Hà');
      const res = await call(t.app, 'PATCH', `/api/departments/${id}`, a.admin.cookie, {
        headMemberId: null,
      });
      expect(res.statusCode).toBe(200);
      expect(await memberRow(harness, a.companyId, ha.memberId)).toMatchObject({
        role: 'member',
        department_id: id,
      });
      const dept = (await list(a.admin.cookie)).departments.find(
        (d: { id: string }) => d.id === id,
      );
      expect(dept.head).toBeNull();
    });

    it('a locked person cannot be chosen', async () => {
      const id = await createDepartment(t.app, a.owner.cookie, `Khoá ${randomUUID().slice(0, 6)}`);
      const quang = await addPerson(t, harness, a.companyId, 'member', a.departmentId);
      await call(t.app, 'POST', `/api/members/${quang.memberId}/lock`, a.owner.cookie);
      const res = await call(t.app, 'PATCH', `/api/departments/${id}`, a.owner.cookie, {
        headMemberId: quang.memberId,
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('Chọn Nhân viên làm trưởng phòng', () => {
    it('Nhân viên phòng khác thành trưởng phòng: role + move + both AuditEvents', async () => {
      const khoVan = await createDepartment(
        t.app,
        a.owner.cookie,
        `Kho vận ${randomUUID().slice(0, 6)}`,
      );
      const tam = await addPerson(
        t,
        harness,
        a.companyId,
        'member',
        a.departmentId,
        'Võ Thành Tâm',
      );
      const res = await call(t.app, 'PATCH', `/api/departments/${khoVan}`, a.admin.cookie, {
        headMemberId: tam.memberId,
      });
      expect(res.statusCode).toBe(200);
      expect(await memberRow(harness, a.companyId, tam.memberId)).toMatchObject({
        role: 'manager',
        department_id: khoVan,
      });
      const events = (await auditEventsOf(harness, a.companyId)).filter(
        (event) => event.target_id === tam.memberId,
      );
      expect(events.map((event) => event.action)).toEqual(
        expect.arrayContaining(['member.role_changed', 'member.moved']),
      );
      expect(await lastAudit(a.companyId, 'department.updated')).toMatchObject({
        target_id: khoVan,
        fields: ['head'],
      });
    });

    it('Thay trưởng phòng: Ngọc becomes head, Lan becomes a Member of the department', async () => {
      const dept = await createDepartment(t.app, a.owner.cookie, `KD2 ${randomUUID().slice(0, 6)}`);
      const lan = await addPerson(t, harness, a.companyId, 'manager', dept, 'Nguyễn Thị Lan');
      const ngoc = await addPerson(t, harness, a.companyId, 'member', dept, 'Bùi Ngọc');
      const res = await call(t.app, 'PATCH', `/api/departments/${dept}`, a.owner.cookie, {
        headMemberId: ngoc.memberId,
      });
      expect(res.statusCode).toBe(200);
      expect(await memberRow(harness, a.companyId, ngoc.memberId)).toMatchObject({
        role: 'manager',
      });
      expect(await memberRow(harness, a.companyId, lan.memberId)).toMatchObject({
        role: 'member',
        department_id: dept,
      });
      const found = (await list(a.owner.cookie)).departments.find(
        (d: { id: string }) => d.id === dept,
      );
      expect(found.head).toEqual({ id: ngoc.memberId, name: 'Bùi Ngọc' });
    });
  });

  describe('review fixes: pending Manager invitations and lock order', () => {
    it('setting a head while a Manager invitation is pending → 409, invitation still usable', async () => {
      const dept = await createDepartment(t.app, a.owner.cookie, `Chờ ${randomUUID().slice(0, 6)}`);
      const res = await call(t.app, 'POST', '/api/invitations', a.owner.cookie, {
        emails: [uniqueEmail('lead')],
        role: 'manager',
        departmentId: dept,
      });
      expect(res.statusCode).toBe(201);
      const p = await addPerson(t, harness, a.companyId, 'member', dept);
      const head = await call(t.app, 'PATCH', `/api/departments/${dept}`, a.owner.cookie, {
        headMemberId: p.memberId,
      });
      expect(head.statusCode).toBe(409);
      expect(head.json().error.code).toBe('DEPARTMENT_HAS_HEAD');
      const promote = await call(t.app, 'PATCH', `/api/members/${p.memberId}`, a.owner.cookie, {
        role: 'manager',
      });
      expect(promote.statusCode).toBe(409);
      expect(await memberRow(harness, a.companyId, p.memberId)).toMatchObject({ role: 'member' });
    });

    it('a head change racing a member move never deadlocks (no 500)', async () => {
      for (let round = 0; round < 5; round += 1) {
        const dept = await createDepartment(
          t.app,
          a.owner.cookie,
          `Đua ${randomUUID().slice(0, 6)}`,
        );
        const x = await addPerson(t, harness, a.companyId, 'member', a.departmentId);
        const results = await Promise.all([
          call(t.app, 'PATCH', `/api/members/${x.memberId}`, a.admin.cookie, {
            departmentId: dept,
          }),
          call(t.app, 'PATCH', `/api/departments/${dept}`, a.owner.cookie, {
            headMemberId: x.memberId,
          }),
        ]);
        for (const res of results) expect(res.statusCode).toBeLessThan(500);
      }
    });
  });

  describe('Lưu trữ thay cho xoá', () => {
    it('Lưu trữ phòng trống: gone from the list, row kept, AuditEvent', async () => {
      const id = await createDepartment(t.app, a.owner.cookie, 'Kho vận cũ');
      const res = await call(t.app, 'POST', `/api/departments/${id}/archive`, a.admin.cookie);
      expect(res.statusCode).toBe(200);
      expect(
        (await list(a.owner.cookie)).departments.map((d: { id: string }) => d.id),
      ).not.toContain(id);
      const rows = await sqlIn(
        harness,
        a.companyId,
        'select archived_at from departments where id = $1',
        [id],
      );
      expect(rows[0].archived_at).not.toBeNull();
      expect(await lastAudit(a.companyId, 'department.archived')).toMatchObject({ target_id: id });
    });

    it('Phòng còn người → 409 DEPARTMENT_NOT_EMPTY with the count; locked people count too', async () => {
      const id = await createDepartment(t.app, a.owner.cookie, `Đông ${randomUUID().slice(0, 6)}`);
      const people = await Promise.all(
        Array.from({ length: 2 }, () => addPerson(t, harness, a.companyId, 'member', id)),
      );
      await call(t.app, 'POST', `/api/members/${people[0]?.memberId}/lock`, a.owner.cookie);
      const res = await call(t.app, 'POST', `/api/departments/${id}/archive`, a.owner.cookie);
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatchObject({
        code: 'DEPARTMENT_NOT_EMPTY',
        details: { members: 2, invitations: 0 },
      });
      expect((await list(a.owner.cookie)).departments.map((d: { id: string }) => d.id)).toContain(
        id,
      );
    });

    it('a pending invitation into the department also blocks archiving', async () => {
      const id = await createDepartment(t.app, a.owner.cookie, `Mời ${randomUUID().slice(0, 6)}`);
      await call(t.app, 'POST', '/api/invitations', a.owner.cookie, {
        emails: [uniqueEmail('inv')],
        role: 'member',
        departmentId: id,
      });
      const res = await call(t.app, 'POST', `/api/departments/${id}/archive`, a.owner.cookie);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.details).toEqual({ members: 0, invitations: 1 });
    });

    it('Tạo lại tên đã lưu trữ → created', async () => {
      const name = `Kho vận ${randomUUID().slice(0, 6)}`;
      const id = await createDepartment(t.app, a.owner.cookie, name);
      await call(t.app, 'POST', `/api/departments/${id}/archive`, a.owner.cookie);
      const res = await call(t.app, 'POST', '/api/departments', a.admin.cookie, { name });
      expect(res.statusCode).toBe(201);
    });

    it('an archived department cannot be edited (404)', async () => {
      const id = await createDepartment(t.app, a.owner.cookie, `Lưu ${randomUUID().slice(0, 6)}`);
      await call(t.app, 'POST', `/api/departments/${id}/archive`, a.owner.cookie);
      const res = await call(t.app, 'PATCH', `/api/departments/${id}`, a.owner.cookie, {
        name: 'X',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('Xem danh sách phòng ban', () => {
    it('Nhân viên sees the departments (no unassigned count)', async () => {
      const res = await call(t.app, 'GET', '/api/departments', a.member.cookie);
      expect(res.statusCode).toBe(200);
      expect(res.json().departments.map((d: { name: string }) => d.name)).toContain('Kinh doanh');
      expect(res.json().unassignedCount).toBeNull();
    });

    it('head, member count and avatars are reported', async () => {
      const kd = (await list(a.owner.cookie)).departments.find(
        (d: { id: string }) => d.id === a.departmentId,
      );
      expect(kd.head).toEqual({ id: a.manager.memberId, name: 'Nguyễn Thị Lan' });
      expect(kd.memberCount).toBeGreaterThanOrEqual(2);
      expect(kd.members.length).toBeLessThanOrEqual(4);
    });

    it('Số người chưa có phòng: Owner sees how many active people have no department', async () => {
      // Owner and Admin of company A have no department.
      expect((await list(a.owner.cookie)).unassignedCount).toBe(2);
    });

    it('Không thấy phòng ban công ty khác', async () => {
      const names = JSON.stringify(await list(a.owner.cookie));
      const ids = (await list(b.owner.cookie)).departments.map((d: { id: string }) => d.id);
      for (const id of ids) expect(names).not.toContain(id);
    });
  });

  describe('tenant isolation and permissions on every department route', () => {
    it.each([
      ['PATCH', (id: string) => `/api/departments/${id}`, { name: 'Hack' }],
      ['POST', (id: string) => `/api/departments/${id}/archive`, undefined],
    ] as const)(
      '%s on company B’s department from A → 404, access.not_found, B unchanged',
      async (method, url, body) => {
        const victim = await createDepartment(
          t.app,
          b.owner.cookie,
          `Của B ${randomUUID().slice(0, 6)}`,
        );
        const res = await call(t.app, method, url(victim), a.admin.cookie, body);
        expect(res.statusCode).toBe(404);
        expect(await lastAudit(a.companyId, 'access.not_found')).toMatchObject({
          actor_member_id: a.admin.memberId,
          target_type: 'department',
          target_id: victim,
        });
        const rows = await sqlIn(
          harness,
          b.companyId,
          'select name, archived_at from departments where id = $1',
          [victim],
        );
        expect(rows[0]).toMatchObject({ archived_at: null });
        expect(rows[0].name).toMatch(/^Của B/);
      },
    );

    it('a malformed id is a 404 too', async () => {
      const res = await call(t.app, 'PATCH', '/api/departments/not-a-uuid', a.owner.cookie, {
        name: 'X',
      });
      expect(res.statusCode).toBe(404);
    });

    it('A cannot make a member of company B the head of its department', async () => {
      const res = await call(t.app, 'PATCH', `/api/departments/${a.departmentId}`, a.owner.cookie, {
        headMemberId: b.member.memberId,
      });
      expect(res.statusCode).toBe(400);
      expect(await memberRow(harness, b.companyId, b.member.memberId)).toMatchObject({
        role: 'member',
      });
    });

    it.each(['manager', 'member'] as const)('%s cannot edit or archive → 403', async (who) => {
      for (const [method, url] of [
        ['PATCH', `/api/departments/${a.departmentId}`],
        ['POST', `/api/departments/${a.departmentId}/archive`],
      ] as const) {
        const res = await call(
          t.app,
          method,
          url,
          a[who].cookie,
          method === 'PATCH' ? { name: 'X' } : undefined,
        );
        expect(res.statusCode).toBe(403);
      }
    });

    it('signed out → 401', async () => {
      expect((await call(t.app, 'GET', '/api/departments')).statusCode).toBe(401);
    });
  });
});
