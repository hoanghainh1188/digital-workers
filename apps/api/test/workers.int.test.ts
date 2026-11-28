import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditEventsOf,
  type Harness,
  makeApp,
  startHarness,
  type TestApp,
} from './support/harness.ts';
import { call, seedOrg, sqlIn } from './support/org.ts';
import {
  addAccounting,
  detail,
  newWorker,
  type WorkerTenant,
  workerIn,
  workerName,
  workerRow,
} from './support/workers.ts';

describe('worker profile (spec worker-profile)', () => {
  let harness: Harness;
  let t: TestApp;
  let a: WorkerTenant;
  let b: WorkerTenant;

  const audits = async (companyId: string, action: string) =>
    (await auditEventsOf(harness, companyId)).filter((event) => event.action === action);
  const lastAudit = async (companyId: string, action: string) =>
    (await audits(companyId, action)).at(-1);

  beforeAll(async () => {
    harness = await startHarness();
    t = makeApp(harness);
    a = await addAccounting(t, harness, await seedOrg(t, harness, 'Gốm An Phú'));
    b = await addAccounting(t, harness, await seedOrg(t, harness, 'Công ty B'));
  });

  afterAll(async () => {
    await t?.app.close();
    await harness?.stop();
  });

  describe('Tuyển worker (3.1)', () => {
    it('lists the three templates for people who may hire', async () => {
      const res = await call(t.app, 'GET', '/api/worker-templates', a.manager.cookie);
      expect(res.statusCode).toBe(200);
      expect(res.json().templates.map((tpl: { id: string }) => tpl.id)).toEqual([
        'quote-assistant',
        'internal-support',
        'report-digest',
      ]);
      expect((await call(t.app, 'GET', '/api/worker-templates', a.member.cookie)).statusCode).toBe(
        403,
      );
    });

    it('Trưởng phòng tạo từ mẫu cho phòng mình → Nháp, mẫu, 300.000đ, người quản lý, AuditEvent', async () => {
      const id = await newWorker(t.app, a.manager.cookie, a.departmentId, {
        templateId: 'quote-assistant',
      });
      const view = (await detail(t.app, a.manager.cookie, id)).json();
      expect(view).toMatchObject({
        status: 'draft',
        department: { id: a.departmentId, name: 'Kinh doanh' },
        monthlyBudgetVnd: 300_000,
        voicePreset: 'polite',
        templateId: 'quote-assistant',
        manager: { id: a.manager.memberId, name: 'Nguyễn Thị Lan' },
        testers: [{ id: a.manager.memberId, name: 'Nguyễn Thị Lan' }],
      });
      expect(view.jobDescription).toContain('báo giá');
      expect(await lastAudit(a.companyId, 'worker.created')).toMatchObject({
        actor_member_id: a.manager.memberId,
        target_type: 'worker',
        target_id: id,
        fields: ['template:quote-assistant'],
      });
    });

    it('Admin tạo hồ sơ trống → mô tả trống; phòng chưa có trưởng phòng → người tạo quản lý', async () => {
      const deptRes = await call(t.app, 'POST', '/api/departments', a.owner.cookie, {
        name: 'Kho vận',
      });
      const id = await newWorker(t.app, a.admin.cookie, deptRes.json().id, {
        name: 'Bảo · Hoá đơn',
        templateId: null,
      });
      const view = (await detail(t.app, a.admin.cookie, id)).json();
      expect(view).toMatchObject({
        jobDescription: '',
        templateId: null,
        manager: { id: a.admin.memberId },
      });
      expect(await lastAudit(a.companyId, 'worker.created')).toMatchObject({
        fields: ['template:blank'],
      });
    });

    it('Trưởng phòng tuyển cho phòng khác → 403, không tạo', async () => {
      const name = workerName('Khác phòng');
      const res = await call(t.app, 'POST', '/api/workers', a.manager.cookie, {
        name,
        departmentId: a.accountingId,
      });
      expect(res.statusCode).toBe(403);
      expect(await lastAudit(a.companyId, 'access.denied')).toMatchObject({
        actor_member_id: a.manager.memberId,
      });
      const rows = await sqlIn(harness, a.companyId, 'select id from workers where name = $1', [
        name,
      ]);
      expect(rows).toEqual([]);
    });

    it('Nhân viên → 403 + access.denied', async () => {
      const res = await call(t.app, 'POST', '/api/workers', a.member.cookie, {
        name: workerName(),
        departmentId: a.departmentId,
      });
      expect(res.statusCode).toBe(403);
      expect(await lastAudit(a.companyId, 'access.denied')).toMatchObject({
        actor_member_id: a.member.memberId,
        target_id: 'worker.create',
      });
    });

    it('phòng đã lưu trữ → 400; phòng công ty khác → 404', async () => {
      const deptRes = await call(t.app, 'POST', '/api/departments', a.owner.cookie, {
        name: `Lưu ${randomUUID()}`,
      });
      const archivedId = deptRes.json().id;
      await call(t.app, 'POST', `/api/departments/${archivedId}/archive`, a.owner.cookie);
      const archived = await call(t.app, 'POST', '/api/workers', a.admin.cookie, {
        name: workerName(),
        departmentId: archivedId,
      });
      expect(archived.statusCode).toBe(400);
      expect(archived.json().error.details).toEqual([
        { path: 'departmentId', message: 'department_archived' },
      ]);
      const foreign = await call(t.app, 'POST', '/api/workers', a.admin.cookie, {
        name: workerName(),
        departmentId: b.departmentId,
      });
      expect(foreign.statusCode).toBe(404);
    });

    it('tên trùng worker đang làm → 409; trùng worker đã nghỉ việc hoặc công ty khác → được', async () => {
      const name = workerName('Minh · Báo giá');
      await workerIn(t, a, 'active', a.departmentId, name);
      const dup = await call(t.app, 'POST', '/api/workers', a.admin.cookie, {
        name: ` ${name.toLowerCase()} `,
        departmentId: a.departmentId,
      });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().error.code).toBe('WORKER_NAME_TAKEN');
      await expect(
        newWorker(t.app, b.admin.cookie, b.departmentId, { name }),
      ).resolves.toBeTruthy();

      const gone = workerName('Quang · Tin nhắn Tết');
      await workerIn(t, a, 'offboarded', a.departmentId, gone);
      await expect(
        newWorker(t.app, a.admin.cookie, a.departmentId, { name: gone }),
      ).resolves.toBeTruthy();
    });
  });

  describe('Phạm vi xem (3.2)', () => {
    let salesId: string;
    let accountingWorkerId: string;

    beforeAll(async () => {
      salesId = await workerIn(t, a, 'probation');
      accountingWorkerId = await workerIn(t, a, 'active', a.accountingId);
    });

    it('Owner thấy mọi worker, không có phần "phòng khác"', async () => {
      const list = (await call(t.app, 'GET', '/api/workers', a.owner.cookie)).json();
      const ids = list.workers.map((w: { id: string }) => w.id);
      expect(ids).toEqual(expect.arrayContaining([salesId, accountingWorkerId]));
      expect(list.otherDepartments).toEqual([]);
    });

    it.each(['manager', 'member'] as const)(
      '%s thấy phòng mình và chỉ số lượng phòng khác, không tên',
      async (who) => {
        const res = await call(t.app, 'GET', '/api/workers', a[who].cookie);
        const list = res.json();
        expect(
          list.workers.every(
            (w: { department: { id: string } }) => w.department.id === a.departmentId,
          ),
        ).toBe(true);
        expect(list.workers.map((w: { id: string }) => w.id)).toContain(salesId);
        expect(list.otherDepartments).toEqual(
          expect.arrayContaining([
            { departmentId: a.accountingId, name: 'Kế toán', count: expect.any(Number) },
          ]),
        );
        expect(
          list.otherDepartments.every(
            (d: { departmentId: string }) => d.departmentId !== a.departmentId,
          ),
        ).toBe(true);
        expect(res.body).not.toContain(accountingWorkerId);
      },
    );

    it('lọc theo trạng thái chỉ trả thẻ đúng trạng thái, bộ đếm giữ nguyên', async () => {
      const list = (
        await call(t.app, 'GET', '/api/workers?status=probation', a.owner.cookie)
      ).json();
      expect(list.workers.length).toBeGreaterThan(0);
      expect(list.workers.every((w: { status: string }) => w.status === 'probation')).toBe(true);
      expect(list.counts.active).toBeGreaterThan(0);
    });

    it('Trưởng phòng mở hồ sơ phòng khác → 403 + access.denied', async () => {
      const res = await detail(t.app, a.manager.cookie, accountingWorkerId);
      expect(res.statusCode).toBe(403);
      expect(await lastAudit(a.companyId, 'access.denied')).toMatchObject({
        actor_member_id: a.manager.memberId,
        target_type: 'worker',
        target_id: accountingWorkerId,
      });
    });

    it('Nhân viên mở hồ sơ phòng mình → chỉ xem, không có thao tác', async () => {
      const view = (await detail(t.app, a.member.cookie, salesId)).json();
      expect(view).toMatchObject({ canEdit: false, availableEvents: [] });
      const history = await call(t.app, 'GET', `/api/workers/${salesId}/history`, a.member.cookie);
      expect(history.statusCode).toBe(200);
    });

    it('id worker công ty khác → 404 + access.not_found, kể cả lịch sử', async () => {
      const foreign = await workerIn(t, b, 'draft');
      expect((await detail(t.app, a.owner.cookie, foreign)).statusCode).toBe(404);
      expect(await lastAudit(a.companyId, 'access.not_found')).toMatchObject({
        target_id: foreign,
      });
      expect(
        (await call(t.app, 'GET', `/api/workers/${foreign}/history`, a.owner.cookie)).statusCode,
      ).toBe(404);
    });
  });

  describe('Sửa hồ sơ (3.3)', () => {
    const patch = (cookie: string, id: string, body: Record<string, unknown>) =>
      call(t.app, 'PATCH', `/api/workers/${id}`, cookie, body);
    const revisionOf = async (id: string) =>
      (await detail(t.app, a.owner.cookie, id)).json().revision as number;

    it('Trưởng phòng sửa mô tả và giọng văn → lưu, AuditEvent chỉ tên trường', async () => {
      const id = await workerIn(t, a, 'draft');
      const res = await patch(a.manager.cookie, id, {
        revision: await revisionOf(id),
        jobDescription: 'Lập báo giá gốm theo bảng giá đại lý',
        voicePreset: 'friendly',
      });
      expect(res.statusCode).toBe(200);
      expect(await lastAudit(a.companyId, 'worker.updated')).toMatchObject({
        target_id: id,
        fields: ['job_description', 'voice_preset'],
      });
      const audit = JSON.stringify(await auditEventsOf(harness, a.companyId));
      expect(audit).not.toContain('Lập báo giá gốm');
    });

    it('mô tả 4.001 ký tự → 400 ở trường mô tả', async () => {
      const id = await workerIn(t, a, 'draft');
      const res = await patch(a.owner.cookie, id, {
        revision: 0,
        jobDescription: 'a'.repeat(4001),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.details).toEqual([{ path: 'jobDescription', message: 'too_long' }]);
    });

    it('trùng tên → 409; revision cũ → 409 PROFILE_CHANGED', async () => {
      const taken = workerName();
      await workerIn(t, a, 'draft', a.departmentId, taken);
      const id = await workerIn(t, a, 'draft');
      const revision = await revisionOf(id);
      const dup = await patch(a.owner.cookie, id, { revision, name: taken.toUpperCase() });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().error.code).toBe('WORKER_NAME_TAKEN');
      expect(
        (await patch(a.owner.cookie, id, { revision, voicePreset: 'formal' })).statusCode,
      ).toBe(200);
      const stale = await patch(a.admin.cookie, id, { revision, voicePreset: 'friendly' });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe('PROFILE_CHANGED');
      expect((await detail(t.app, a.owner.cookie, id)).json().voicePreset).toBe('formal');
    });

    it('ngân sách: Trưởng phòng vượt trần 403, Owner 3.000.000đ được, Trưởng phòng sửa worker cao 403', async () => {
      const id = await workerIn(t, a, 'draft');
      const over = await patch(a.manager.cookie, id, {
        revision: await revisionOf(id),
        monthlyBudgetVnd: 2_500_000,
      });
      expect(over.statusCode).toBe(403);
      expect(over.json().error.code).toBe('BUDGET_ABOVE_MANAGER_CAP');
      const owner = await patch(a.owner.cookie, id, {
        revision: await revisionOf(id),
        monthlyBudgetVnd: 3_000_000,
      });
      expect(owner.statusCode).toBe(200);
      const view = (await detail(t.app, a.manager.cookie, id)).json();
      expect(view).toMatchObject({ monthlyBudgetVnd: 3_000_000, budgetLocked: true });
      const lower = await patch(a.manager.cookie, id, {
        revision: view.revision,
        monthlyBudgetVnd: 1_000_000,
      });
      expect(lower.statusCode).toBe(403);
      // Sending the current value back is not a change: other fields still save.
      const same = await patch(a.manager.cookie, id, {
        revision: view.revision,
        monthlyBudgetVnd: 3_000_000,
        voicePreset: 'formal',
      });
      expect(same.statusCode).toBe(200);
      expect((await workerRow(harness, a.companyId, id))?.monthly_budget_vnd).toBe('3000000');
    });

    it('ngân sách không nguyên → 400', async () => {
      const id = await workerIn(t, a, 'draft');
      const res = await patch(a.owner.cookie, id, { revision: 0, monthlyBudgetVnd: 150000.5 });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.details).toEqual([
        { path: 'monthlyBudgetVnd', message: 'budget_integer' },
      ]);
    });

    it('người quản lý: nhân viên phòng mình được, phòng khác 400, công ty khác 404', async () => {
      const id = await workerIn(t, a, 'draft');
      const ok = await patch(a.manager.cookie, id, {
        revision: await revisionOf(id),
        managerMemberId: a.member.memberId,
      });
      expect(ok.statusCode).toBe(200);
      expect((await detail(t.app, a.owner.cookie, id)).json().manager).toEqual({
        id: a.member.memberId,
        name: 'Hoàng Văn Việt',
      });
      const other = await patch(a.admin.cookie, id, {
        revision: await revisionOf(id),
        managerMemberId: a.accountingMember.memberId,
      });
      expect(other.statusCode).toBe(400);
      expect(other.json().error.details).toEqual([
        { path: 'managerMemberId', message: 'manager_not_eligible' },
      ]);
      const foreign = await patch(a.admin.cookie, id, {
        revision: await revisionOf(id),
        managerMemberId: b.member.memberId,
      });
      expect(foreign.statusCode).toBe(404);
      expect((await workerRow(harness, a.companyId, id))?.manager_member_id).toBe(
        a.member.memberId,
      );
    });

    it('worker đã nghỉ việc → 409; Nhân viên → 403; Trưởng phòng phòng khác → 403', async () => {
      const gone = await workerIn(t, a, 'offboarded');
      const offboarded = await patch(a.owner.cookie, gone, {
        revision: await revisionOf(gone),
        jobDescription: 'x',
      });
      expect(offboarded.statusCode).toBe(409);
      expect(offboarded.json().error.code).toBe('WORKER_OFFBOARDED');
      const id = await workerIn(t, a, 'draft');
      expect(
        (await patch(a.member.cookie, id, { revision: 0, jobDescription: 'x' })).statusCode,
      ).toBe(403);
      expect(
        (await patch(a.accountingManager.cookie, id, { revision: 0, jobDescription: 'x' }))
          .statusCode,
      ).toBe(403);
    });
  });

  describe('Đổi phòng và người được giao thử (3.4)', () => {
    it('Admin chuyển worker Chính thức sang Kế toán → vẫn Chính thức, quản lý là trưởng phòng mới', async () => {
      const id = await workerIn(t, a, 'active');
      const res = await call(t.app, 'POST', `/api/workers/${id}/department`, a.admin.cookie, {
        departmentId: a.accountingId,
      });
      expect(res.statusCode).toBe(200);
      const view = (await detail(t.app, a.owner.cookie, id)).json();
      expect(view).toMatchObject({
        status: 'active',
        department: { id: a.accountingId },
        manager: { id: a.accountingManager.memberId },
        testers: [],
      });
      expect(await lastAudit(a.companyId, 'worker.department_changed')).toMatchObject({
        target_id: id,
      });
    });

    it('Trưởng phòng đổi phòng → 403', async () => {
      const id = await workerIn(t, a, 'draft');
      const res = await call(t.app, 'POST', `/api/workers/${id}/department`, a.manager.cookie, {
        departmentId: a.accountingId,
      });
      expect(res.statusCode).toBe(403);
      expect((await workerRow(harness, a.companyId, id))?.department_id).toBe(a.departmentId);
    });

    it('người được giao thử: Trưởng phòng thêm được, 11 người 400, Nhân viên 403, công ty khác 404', async () => {
      const id = await workerIn(t, a, 'probation');
      const put = (cookie: string, memberIds: string[]) =>
        call(t.app, 'PUT', `/api/workers/${id}/testers`, cookie, { memberIds });
      const ok = await put(a.manager.cookie, [a.manager.memberId, a.member.memberId]);
      expect(ok.statusCode).toBe(200);
      expect(
        (await detail(t.app, a.owner.cookie, id))
          .json()
          .testers.map((p: { id: string }) => p.id)
          .sort(),
      ).toEqual([a.manager.memberId, a.member.memberId].sort());
      expect(await lastAudit(a.companyId, 'worker.testers_changed')).toMatchObject({
        target_id: id,
      });
      const eleven = Array.from({ length: 11 }, () => randomUUID());
      expect((await put(a.admin.cookie, eleven)).statusCode).toBe(400);
      expect((await put(a.member.cookie, [a.member.memberId])).statusCode).toBe(403);
      expect((await put(a.admin.cookie, [b.member.memberId])).statusCode).toBe(404);
      expect((await put(a.admin.cookie, [a.accountingMember.memberId])).statusCode).toBe(400);
    });

    it('worker công ty khác → 404 khi đổi phòng', async () => {
      const foreign = await workerIn(t, b, 'draft');
      const res = await call(t.app, 'POST', `/api/workers/${foreign}/department`, a.admin.cookie, {
        departmentId: a.accountingId,
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
