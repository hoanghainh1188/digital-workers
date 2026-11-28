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
  historyRows,
  newWorker,
  transition,
  type WorkerTenant,
  workerIn,
  workerName,
  workerRow,
} from './support/workers.ts';

describe('worker lifecycle (spec worker-lifecycle)', () => {
  let harness: Harness;
  let t: TestApp;
  let a: WorkerTenant;
  let b: WorkerTenant;

  const lastAudit = async (companyId: string, action: string) =>
    (await auditEventsOf(harness, companyId)).filter((event) => event.action === action).at(-1);
  const statusOf = async (id: string) => (await workerRow(harness, a.companyId, id))?.status;

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

  describe('Đường hợp lệ (4.1)', () => {
    it('Trưởng phòng cho thử việc → Thử việc, ngày bắt đầu + 14 ngày, lịch sử, AuditEvent', async () => {
      const id = await newWorker(t.app, a.manager.cookie, a.departmentId);
      const res = await transition(t.app, a.manager.cookie, id, 'startProbation', 'draft');
      expect(res.statusCode).toBe(200);
      const row = await workerRow(harness, a.companyId, id);
      expect(row?.status).toBe('probation');
      const start = row?.probation_started_on ?? '';
      const end = new Date(Date.parse(`${start}T00:00:00Z`) + 14 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      expect(row?.probation_ends_on).toBe(end);
      expect((await detail(t.app, a.manager.cookie, id)).json().probation).toMatchObject({
        day: 1,
        total: 14,
        expired: false,
      });
      expect(await lastAudit(a.companyId, 'worker.status_changed')).toMatchObject({
        actor_member_id: a.manager.memberId,
        target_id: id,
        fields: ['status'],
      });
      expect((await historyRows(harness, a.companyId, id)).map((r) => r.kind)).toEqual([
        'created',
        'status_changed',
      ]);
    });

    it('cho thử việc khi mô tả trống → 400 và vẫn Nháp', async () => {
      const id = await newWorker(t.app, a.admin.cookie, a.departmentId, { templateId: null });
      const res = await transition(t.app, a.admin.cookie, id, 'startProbation', 'draft');
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('JOB_DESCRIPTION_REQUIRED');
      expect(await statusOf(id)).toBe('draft');
    });

    it('Owner duyệt chính thức không cần đề nghị → Chính thức, 300.000đ thành 800.000đ', async () => {
      const id = await workerIn(t, a, 'probation');
      const res = await transition(t.app, a.owner.cookie, id, 'activate', 'probation');
      expect(res.statusCode).toBe(200);
      const row = await workerRow(harness, a.companyId, id);
      expect(row).toMatchObject({ status: 'active', monthly_budget_vnd: '800000' });
      const last = (await historyRows(harness, a.companyId, id)).at(-1);
      expect(last).toMatchObject({
        to_status: 'active',
        actor_member_id: a.owner.memberId,
        request_id: null,
      });
    });

    it('ngân sách đã chỉnh 500.000đ giữ nguyên khi lên chính thức', async () => {
      const id = await workerIn(t, a, 'probation');
      await call(t.app, 'PATCH', `/api/workers/${id}`, a.owner.cookie, {
        revision: (await workerRow(harness, a.companyId, id))?.revision,
        monthlyBudgetVnd: 500_000,
      });
      await transition(t.app, a.owner.cookie, id, 'activate', 'probation');
      expect((await workerRow(harness, a.companyId, id))?.monthly_budget_vnd).toBe('500000');
    });

    it('Trưởng phòng tạm nghỉ không lý do rồi đi làm lại', async () => {
      const id = await workerIn(t, a, 'active');
      expect((await transition(t.app, a.manager.cookie, id, 'suspend', 'active')).statusCode).toBe(
        200,
      );
      expect(await statusOf(id)).toBe('suspended');
      expect(
        (await transition(t.app, a.manager.cookie, id, 'resume', 'suspended')).statusCode,
      ).toBe(200);
      expect(await statusOf(id)).toBe('active');
      const rows = await historyRows(harness, a.companyId, id);
      expect(rows.slice(-2).map((r) => [r.from_status, r.to_status, r.actor_member_id])).toEqual([
        ['active', 'suspended', a.manager.memberId],
        ['suspended', 'active', a.manager.memberId],
      ]);
    });

    it.each([
      ['draft', 'activate'],
      ['probation', 'suspend'],
      ['active', 'startProbation'],
    ] as const)(
      'đường không hợp lệ từ %s bằng %s → 409, trạng thái giữ nguyên',
      async (status, event) => {
        const id = await workerIn(t, a, status);
        const res = await transition(t.app, a.admin.cookie, id, event, status);
        expect(res.statusCode).toBe(409);
        expect(res.json().error.code).toBe('INVALID_TRANSITION');
        expect(await statusOf(id)).toBe(status);
      },
    );
  });

  describe('Quyền chuyển trạng thái (4.2)', () => {
    it('Trưởng phòng tự cho chính thức → 403, vẫn Thử việc', async () => {
      const id = await workerIn(t, a, 'probation');
      expect(
        (await transition(t.app, a.manager.cookie, id, 'activate', 'probation')).statusCode,
      ).toBe(403);
      expect(await statusOf(id)).toBe('probation');
    });

    it.each([
      ['suspend', 'active'],
      ['offboard', 'active'],
      ['startProbation', 'draft'],
    ] as const)(
      'Trưởng phòng Kế toán %s worker Kinh doanh → 403 + access.denied',
      async (event, status) => {
        const id = await workerIn(t, a, status);
        const res = await transition(t.app, a.accountingManager.cookie, id, event, status, {
          reason: 'x',
          confirmName: 'x',
        });
        expect(res.statusCode).toBe(403);
        expect(await statusOf(id)).toBe(status);
        expect(await lastAudit(a.companyId, 'access.denied')).toMatchObject({
          actor_member_id: a.accountingManager.memberId,
          target_type: 'worker',
          target_id: id,
        });
      },
    );

    it('Nhân viên là người quản lý cho tạm nghỉ → 403', async () => {
      const id = await workerIn(t, a, 'active');
      await call(t.app, 'PATCH', `/api/workers/${id}`, a.owner.cookie, {
        revision: (await workerRow(harness, a.companyId, id))?.revision,
        managerMemberId: a.member.memberId,
      });
      expect((await transition(t.app, a.member.cookie, id, 'suspend', 'active')).statusCode).toBe(
        403,
      );
      expect(await statusOf(id)).toBe('active');
    });

    it('Admin công ty A chuyển worker công ty B → 404, B giữ nguyên', async () => {
      const foreign = await workerIn(t, b, 'active');
      expect(
        (await transition(t.app, a.admin.cookie, foreign, 'suspend', 'active')).statusCode,
      ).toBe(404);
      expect((await workerRow(harness, b.companyId, foreign))?.status).toBe('active');
    });
  });

  describe('Nghỉ việc và đồng thời (4.3)', () => {
    it('thiếu lý do hoặc sai tên → 400, trạng thái giữ nguyên', async () => {
      const name = workerName();
      const id = await workerIn(t, a, 'active', a.departmentId, name);
      const noReason = await transition(t.app, a.manager.cookie, id, 'offboard', 'active', {
        confirmName: name,
      });
      expect(noReason.statusCode).toBe(400);
      expect(noReason.json().error.code).toBe('REASON_REQUIRED');
      const wrongName = await transition(t.app, a.manager.cookie, id, 'offboard', 'active', {
        reason: 'Đổi sang dùng Zalo OA',
        confirmName: 'sai tên',
      });
      expect(wrongName.statusCode).toBe(400);
      expect(wrongName.json().error.code).toBe('CONFIRM_NAME_MISMATCH');
      expect(await statusOf(id)).toBe('active');
    });

    it('Owner cho worker Tạm nghỉ nghỉ việc → lịch sử có lý do; mọi sự kiện sau đó 409', async () => {
      const name = workerName();
      const id = await workerIn(t, a, 'suspended', a.departmentId, name);
      const res = await transition(t.app, a.owner.cookie, id, 'offboard', 'suspended', {
        reason: 'Đổi sang dùng Zalo OA',
        confirmName: name,
      });
      expect(res.statusCode).toBe(200);
      expect((await historyRows(harness, a.companyId, id)).at(-1)).toMatchObject({
        to_status: 'offboarded',
        actor_member_id: a.owner.memberId,
        reason: 'Đổi sang dùng Zalo OA',
      });
      for (const event of ['activate', 'suspend', 'resume', 'startProbation', 'offboard']) {
        const again = await transition(t.app, a.owner.cookie, id, event, 'offboarded', {
          reason: 'x',
          confirmName: name,
        });
        expect(again.statusCode).toBe(409);
        expect(again.json().error.code).toBe('WORKER_OFFBOARDED');
      }
      const extend = await call(
        t.app,
        'POST',
        `/api/workers/${id}/probation/extend`,
        a.owner.cookie,
        { days: 7 },
      );
      expect(extend.json().error.code).toBe('WORKER_OFFBOARDED');
      const move = await call(t.app, 'POST', `/api/workers/${id}/department`, a.owner.cookie, {
        departmentId: a.accountingId,
      });
      expect(move.statusCode).toBe(409);
      expect(await statusOf(id)).toBe('offboarded');
      expect((await detail(t.app, a.owner.cookie, id)).json()).toMatchObject({
        canEdit: false,
        availableEvents: [],
      });
    });

    it('Trưởng phòng bỏ bản nháp → Nghỉ việc, tên được giải phóng', async () => {
      const name = workerName();
      const id = await newWorker(t.app, a.manager.cookie, a.departmentId, { name });
      const res = await transition(t.app, a.manager.cookie, id, 'offboard', 'draft', {
        reason: 'Tạo nhầm',
        confirmName: name,
      });
      expect(res.statusCode).toBe(200);
      await expect(
        newWorker(t.app, a.manager.cookie, a.departmentId, { name }),
      ).resolves.toBeTruthy();
    });

    it('nghỉ việc đóng đề nghị đang chờ', async () => {
      const name = workerName();
      const id = await workerIn(t, a, 'probation', a.departmentId, name);
      await call(t.app, 'POST', `/api/workers/${id}/promotion-request`, a.manager.cookie, {});
      await transition(t.app, a.owner.cookie, id, 'offboard', 'probation', {
        reason: 'Thôi',
        confirmName: name,
      });
      const rows = await sqlIn(
        harness,
        a.companyId,
        'select status from worker_promotion_requests where worker_id = $1',
        [id],
      );
      expect(rows).toEqual([{ status: 'closed' }]);
    });

    it('hai yêu cầu song song cùng trạng thái thấy → một thành công, một 409, lịch sử một dòng', async () => {
      const name = workerName();
      const id = await workerIn(t, a, 'active', a.departmentId, name);
      const before = (await historyRows(harness, a.companyId, id)).length;
      const [first, second] = await Promise.all([
        transition(t.app, a.owner.cookie, id, 'offboard', 'active', {
          reason: 'Thôi',
          confirmName: name,
        }),
        transition(t.app, a.manager.cookie, id, 'suspend', 'active'),
      ]);
      const codes = [first.statusCode, second.statusCode].sort();
      expect(codes).toEqual([200, 409]);
      const loser = first.statusCode === 409 ? first : second;
      // Offboarding won → the suspend sees an offboarded worker; suspend won → STATUS_CHANGED.
      expect(['WORKER_OFFBOARDED', 'STATUS_CHANGED']).toContain(loser.json().error.code);
      expect((await historyRows(harness, a.companyId, id)).length).toBe(before + 1);
    });
  });

  describe('Đề nghị, trả lại, gia hạn (4.4)', () => {
    const propose = (cookie: string, id: string, note?: string) =>
      call(t.app, 'POST', `/api/workers/${id}/promotion-request`, cookie, note ? { note } : {});
    const giveBack = (cookie: string, id: string, reason: string) =>
      call(t.app, 'POST', `/api/workers/${id}/promotion-request/return`, cookie, { reason });

    it('Trưởng phòng đề nghị → đang chờ, vẫn Thử việc, AuditEvent; lần hai 409', async () => {
      const id = await workerIn(t, a, 'probation');
      const res = await propose(a.manager.cookie, id, 'Đã đúng giá 20 báo giá');
      expect(res.statusCode).toBe(201);
      expect(await statusOf(id)).toBe('probation');
      const view = (await detail(t.app, a.owner.cookie, id)).json();
      expect(view.pendingProposal).toMatchObject({
        requestedBy: { id: a.manager.memberId },
        note: 'Đã đúng giá 20 báo giá',
      });
      expect(view.availableEvents).toContain('returnProposal');
      expect(await lastAudit(a.companyId, 'worker.promotion_requested')).toMatchObject({
        target_id: id,
      });
      const again = await propose(a.manager.cookie, id);
      expect(again.statusCode).toBe(409);
      expect(again.json().error.code).toBe('PROPOSAL_PENDING');
      const rows = await sqlIn(
        harness,
        a.companyId,
        "select id from worker_promotion_requests where worker_id = $1 and status = 'pending'",
        [id],
      );
      expect(rows).toHaveLength(1);
    });

    it('Nhân viên đề nghị → 403, không có đề nghị', async () => {
      const id = await workerIn(t, a, 'probation');
      expect((await propose(a.member.cookie, id)).statusCode).toBe(403);
      const rows = await sqlIn(
        harness,
        a.companyId,
        'select id from worker_promotion_requests where worker_id = $1',
        [id],
      );
      expect(rows).toEqual([]);
    });

    it('trả lại thiếu lý do 400; Trưởng phòng duyệt / trả lại 403', async () => {
      const id = await workerIn(t, a, 'probation');
      await propose(a.manager.cookie, id);
      expect((await giveBack(a.admin.cookie, id, '  ')).statusCode).toBe(400);
      expect((await giveBack(a.manager.cookie, id, 'Sai giá')).statusCode).toBe(403);
      expect(
        (await transition(t.app, a.manager.cookie, id, 'activate', 'probation')).statusCode,
      ).toBe(403);
      const rows = await sqlIn(
        harness,
        a.companyId,
        'select status from worker_promotion_requests where worker_id = $1',
        [id],
      );
      expect(rows).toEqual([{ status: 'pending' }]);
    });

    it('Admin trả lại có lý do → vẫn Thử việc, lý do hiện trên hồ sơ, đề nghị lại được', async () => {
      const id = await workerIn(t, a, 'probation');
      await propose(a.manager.cookie, id);
      const res = await giveBack(a.admin.cookie, id, 'Còn sai giá ở 2 báo giá');
      expect(res.statusCode).toBe(200);
      expect(await statusOf(id)).toBe('probation');
      const view = (await detail(t.app, a.manager.cookie, id)).json();
      expect(view).toMatchObject({
        pendingProposal: null,
        lastReturnedProposal: {
          reason: 'Còn sai giá ở 2 báo giá',
          decidedBy: { id: a.admin.memberId },
        },
      });
      expect(await lastAudit(a.companyId, 'worker.promotion_returned')).toMatchObject({
        target_id: id,
      });
      expect((await propose(a.manager.cookie, id)).statusCode).toBe(201);
    });

    it('Owner duyệt đề nghị → lịch sử ghi người đề nghị và người duyệt', async () => {
      const id = await workerIn(t, a, 'probation');
      await propose(a.manager.cookie, id);
      expect(
        (await transition(t.app, a.owner.cookie, id, 'activate', 'probation')).statusCode,
      ).toBe(200);
      const history = (
        await call(t.app, 'GET', `/api/workers/${id}/history`, a.member.cookie)
      ).json();
      expect(history.events[0]).toMatchObject({
        kind: 'status_changed',
        toStatus: 'active',
        actor: { id: a.owner.memberId },
        proposer: { id: a.manager.memberId, name: 'Nguyễn Thị Lan' },
      });
      expect(history.events.map((e: { kind: string }) => e.kind)).toEqual([
        'status_changed',
        'proposed',
        'status_changed',
        'created',
      ]);
      const rows = await sqlIn(
        harness,
        a.companyId,
        'select status, decided_by_member_id from worker_promotion_requests where worker_id = $1',
        [id],
      );
      expect(rows).toEqual([{ status: 'approved', decided_by_member_id: a.owner.memberId }]);
    });

    it('gia hạn 10 ngày 400; Trưởng phòng gia hạn 7 ngày lùi ngày hết hạn + AuditEvent', async () => {
      const id = await workerIn(t, a, 'probation');
      const before = (await workerRow(harness, a.companyId, id))?.probation_ends_on ?? '';
      const ten = await call(t.app, 'POST', `/api/workers/${id}/probation/extend`, a.admin.cookie, {
        days: 10,
      });
      expect(ten.statusCode).toBe(400);
      const seven = await call(
        t.app,
        'POST',
        `/api/workers/${id}/probation/extend`,
        a.manager.cookie,
        { days: 7 },
      );
      expect(seven.statusCode).toBe(200);
      const after = (await workerRow(harness, a.companyId, id))?.probation_ends_on;
      expect(after).toBe(
        new Date(Date.parse(`${before}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10),
      );
      expect(await lastAudit(a.companyId, 'worker.probation_extended')).toMatchObject({
        actor_member_id: a.manager.memberId,
        target_id: id,
      });
      expect((await detail(t.app, a.manager.cookie, id)).json().probation.total).toBe(21);
    });
  });
});
