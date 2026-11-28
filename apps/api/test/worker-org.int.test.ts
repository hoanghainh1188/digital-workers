import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditEventsOf,
  type Harness,
  makeApp,
  startHarness,
  type TestApp,
} from './support/harness.ts';
import { addPerson, call, createDepartment, seedOrg, sqlIn } from './support/org.ts';
import {
  addAccounting,
  detail,
  type WorkerTenant,
  workerIn,
  workerRow,
} from './support/workers.ts';

describe('workers and member / department changes (design D5)', () => {
  let harness: Harness;
  let t: TestApp;
  let a: WorkerTenant;

  const testersOf = async (id: string) =>
    (
      await sqlIn(
        harness,
        a.companyId,
        'select member_id from worker_testers where worker_id = $1',
        [id],
      )
    ).map((row) => row.member_id as string);

  beforeAll(async () => {
    harness = await startHarness();
    t = makeApp(harness);
    a = await addAccounting(t, harness, await seedOrg(t, harness, 'Gốm An Phú'));
  });

  afterAll(async () => {
    await t?.app.close();
    await harness?.stop();
  });

  describe('Người quản lý rời phòng (5.1)', () => {
    it('khoá người quản lý → về trưởng phòng; bị bỏ khỏi người được giao thử', async () => {
      const viet = await addPerson(
        t,
        harness,
        a.companyId,
        'member',
        a.departmentId,
        'Hoàng Văn Việt 2',
      );
      const id = await workerIn(t, a, 'probation');
      const revision = (await workerRow(harness, a.companyId, id))?.revision;
      await call(t.app, 'PATCH', `/api/workers/${id}`, a.owner.cookie, {
        revision,
        managerMemberId: viet.memberId,
      });
      await call(t.app, 'PUT', `/api/workers/${id}/testers`, a.owner.cookie, {
        memberIds: [viet.memberId, a.manager.memberId],
      });
      expect(
        (await call(t.app, 'POST', `/api/members/${viet.memberId}/lock`, a.owner.cookie))
          .statusCode,
      ).toBe(200);
      expect((await workerRow(harness, a.companyId, id))?.manager_member_id).toBe(
        a.manager.memberId,
      );
      expect(await testersOf(id)).toEqual([a.manager.memberId]);
      const audit = (await auditEventsOf(harness, a.companyId)).filter(
        (e) => e.action === 'worker.manager_reassigned',
      );
      expect(audit.at(-1)).toMatchObject({ target_id: id, fields: ['manager'] });
    });

    it('chuyển trưởng phòng Kế toán sang phòng khác → worker "chưa có người quản lý"', async () => {
      const head = await addPerson(
        t,
        harness,
        a.companyId,
        'manager',
        await createDepartment(t.app, a.owner.cookie, 'Công nợ'),
        'Trưởng Công nợ',
      );
      const debtDept = (
        await sqlIn(harness, a.companyId, 'select department_id from members where id = $1', [
          head.memberId,
        ])
      )[0]?.department_id as string;
      const id = await workerIn(t, a, 'active', debtDept);
      expect((await workerRow(harness, a.companyId, id))?.manager_member_id).toBe(head.memberId);
      const move = await call(t.app, 'PATCH', `/api/members/${head.memberId}`, a.admin.cookie, {
        departmentId: a.departmentId,
        role: 'member',
      });
      expect(move.statusCode).toBe(200);
      expect((await workerRow(harness, a.companyId, id))?.manager_member_id).toBeNull();
      expect((await detail(t.app, a.owner.cookie, id)).json().manager).toBeNull();
    });

    it('Owner chuyển phòng (Owner không có phòng) vẫn giữ vai trò người quản lý', async () => {
      const id = await workerIn(t, a, 'active', a.accountingId);
      const revision = (await workerRow(harness, a.companyId, id))?.revision;
      await call(t.app, 'PATCH', `/api/workers/${id}`, a.owner.cookie, {
        revision,
        managerMemberId: a.admin.memberId,
      });
      await call(t.app, 'PATCH', `/api/members/${a.admin.memberId}`, a.owner.cookie, {
        departmentId: a.departmentId,
      });
      expect((await workerRow(harness, a.companyId, id))?.manager_member_id).toBe(a.admin.memberId);
      await call(t.app, 'PATCH', `/api/members/${a.admin.memberId}`, a.owner.cookie, {
        departmentId: null,
      });
    });

    it('nhân viên được chọn làm trưởng phòng khác → rời người quản lý và người được giao thử phòng cũ', async () => {
      const dept = await createDepartment(t.app, a.owner.cookie, 'Marketing');
      const nam = await addPerson(
        t,
        harness,
        a.companyId,
        'member',
        a.departmentId,
        'Nam Kinh doanh',
      );
      const id = await workerIn(t, a, 'probation');
      const revision = (await workerRow(harness, a.companyId, id))?.revision;
      await call(t.app, 'PATCH', `/api/workers/${id}`, a.owner.cookie, {
        revision,
        managerMemberId: nam.memberId,
      });
      await call(t.app, 'PUT', `/api/workers/${id}/testers`, a.owner.cookie, {
        memberIds: [nam.memberId],
      });
      const head = await call(t.app, 'PATCH', `/api/departments/${dept}`, a.owner.cookie, {
        headMemberId: nam.memberId,
      });
      expect(head.statusCode).toBe(200);
      expect((await workerRow(harness, a.companyId, id))?.manager_member_id).toBe(
        a.manager.memberId,
      );
      expect(await testersOf(id)).toEqual([]);
    });
  });

  describe('Lưu trữ phòng còn worker (5.2)', () => {
    it('phòng không còn người nhưng còn worker Tạm nghỉ → 409 kèm số worker', async () => {
      const dept = await createDepartment(t.app, a.owner.cookie, 'Kho vận');
      await workerIn(t, a, 'suspended', dept);
      const res = await call(t.app, 'POST', `/api/departments/${dept}/archive`, a.admin.cookie);
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatchObject({
        code: 'DEPARTMENT_HAS_WORKERS',
        details: { workers: 1 },
      });
    });

    it('phòng chỉ còn worker đã nghỉ việc → lưu trữ được, worker vẫn tra cứu với tên phòng cũ', async () => {
      const dept = await createDepartment(t.app, a.owner.cookie, 'Kho cũ');
      const id = await workerIn(t, a, 'offboarded', dept);
      expect(
        (await call(t.app, 'POST', `/api/departments/${dept}/archive`, a.admin.cookie)).statusCode,
      ).toBe(200);
      expect((await detail(t.app, a.owner.cookie, id)).json().department).toEqual({
        id: dept,
        name: 'Kho cũ',
        archived: true,
      });
    });
  });
});
