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
import { approvedSkill, assign, createSkill, raw, skillMd, skillName } from './support/skills.ts';
import { addAccounting, transition, type WorkerTenant, workerIn } from './support/workers.ts';

describe('worker skills (spec worker-skills)', () => {
  let harness: Harness;
  let t: TestApp;
  let a: WorkerTenant;
  let b: WorkerTenant;

  const audits = async (companyId: string, action: string) =>
    (await auditEventsOf(harness, companyId)).filter((event) => event.action === action);
  const rowsOf = (companyId: string, workerId: string) =>
    sqlIn(harness, companyId, 'select skill_id, status from worker_skills where worker_id = $1', [
      workerId,
    ]);
  const list = async (cookie: string, workerId: string) =>
    (await call(t.app, 'GET', `/api/workers/${workerId}/skills`, cookie)).json();
  const decide = (
    cookie: string,
    workerId: string,
    skillId: string,
    decision: 'approve' | 'reject',
  ) => call(t.app, 'POST', `/api/workers/${workerId}/skills/${skillId}/${decision}`, cookie);

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

  describe('Chỉ giao kỹ năng đã duyệt (6.1)', () => {
    it('kỹ năng chỉ có bản nháp → 409 SKILL_NOT_APPROVED; lưu trữ → 409 SKILL_ARCHIVED', async () => {
      const worker = await workerIn(t, a, 'probation');
      const draft = await createSkill(t.app, a.owner.cookie, skillMd(skillName()));
      const res = await assign(t.app, a.admin.cookie, worker, draft);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('SKILL_NOT_APPROVED');
      const old = await approvedSkill(t.app, a.owner.cookie);
      await call(t.app, 'POST', `/api/skills/${old.id}/archive`, a.owner.cookie);
      expect((await assign(t.app, a.admin.cookie, worker, old.id)).json().error.code).toBe(
        'SKILL_ARCHIVED',
      );
      expect(await rowsOf(a.companyId, worker)).toEqual([]);
    });

    it('worker Nghỉ việc → 409; giao hai lần → 409 ALREADY_ASSIGNED', async () => {
      const skill = await approvedSkill(t.app, a.owner.cookie);
      const gone = await workerIn(t, a, 'offboarded');
      expect((await assign(t.app, a.admin.cookie, gone, skill.id)).json().error.code).toBe(
        'WORKER_OFFBOARDED',
      );
      const worker = await workerIn(t, a, 'draft');
      expect((await assign(t.app, a.admin.cookie, worker, skill.id)).statusCode).toBe(201);
      expect((await assign(t.app, a.admin.cookie, worker, skill.id)).json().error.code).toBe(
        'ALREADY_ASSIGNED',
      );
    });

    it('cùng luật ở hai nơi: Trưởng phòng giao cho worker Chính thức hai lần → một yêu cầu chờ duyệt', async () => {
      const skill = await approvedSkill(t.app, a.owner.cookie);
      const worker = await workerIn(t, a, 'active');
      const first = await assign(t.app, a.manager.cookie, worker, skill.id);
      expect(first.statusCode).toBe(201);
      expect(first.json().status).toBe('pending');
      expect((await assign(t.app, a.manager.cookie, worker, skill.id)).statusCode).toBe(409);
      expect(await rowsOf(a.companyId, worker)).toEqual([
        { skill_id: skill.id, status: 'pending' },
      ]);
      expect((await audits(a.companyId, 'worker_skill.requested')).at(-1)).toMatchObject({
        target_type: 'worker_skill',
        target_id: `${worker}:${skill.id}`,
      });
    });
  });

  describe('Ai được giao, Nháp / Thử việc, Chính thức (6.1)', () => {
    it('Nhân viên giao → 403 + access.denied; Trưởng phòng giao cho phòng khác → 403', async () => {
      const skill = await approvedSkill(t.app, a.owner.cookie);
      const worker = await workerIn(t, a, 'probation');
      const before = (await audits(a.companyId, 'access.denied')).length;
      expect((await assign(t.app, a.member.cookie, worker, skill.id)).statusCode).toBe(403);
      expect((await audits(a.companyId, 'access.denied')).length).toBe(before + 1);
      const accounting = await workerIn(t, a, 'probation', a.accountingId);
      expect((await assign(t.app, a.manager.cookie, accounting, skill.id)).statusCode).toBe(403);
      expect(await rowsOf(a.companyId, accounting)).toEqual([]);
    });

    it('Trưởng phòng giao kỹ năng không script cho worker Thử việc phòng mình → dùng ngay', async () => {
      const skill = await approvedSkill(t.app, a.owner.cookie, {
        name: skillName('tom-tat-email'),
      });
      const worker = await workerIn(t, a, 'probation');
      const res = await assign(t.app, a.manager.cookie, worker, skill.id);
      expect(res.json()).toEqual({ status: 'active' });
      expect((await audits(a.companyId, 'worker_skill.assigned')).at(-1)?.target_id).toBe(
        `${worker}:${skill.id}`,
      );
    });

    it('Admin giao cho worker Chính thức → dùng ngay; Trưởng phòng → chờ duyệt, Owner duyệt → đang dùng', async () => {
      const skill = await approvedSkill(t.app, a.owner.cookie);
      const other = await approvedSkill(t.app, a.owner.cookie);
      const worker = await workerIn(t, a, 'active');
      expect((await assign(t.app, a.admin.cookie, worker, skill.id)).json().status).toBe('active');
      expect((await assign(t.app, a.manager.cookie, worker, other.id)).json().status).toBe(
        'pending',
      );
      const view = await list(a.owner.cookie, worker);
      expect(
        view.skills.map((s: { skillId: string; status: string; currentNumber: number }) => [
          s.skillId,
          s.status,
          s.currentNumber,
        ]),
      ).toEqual(
        expect.arrayContaining([
          [skill.id, 'active', 1],
          [other.id, 'pending', 1],
        ]),
      );
      expect(view.canApprove).toBe(true);
      const detail = (await call(t.app, 'GET', `/api/skills/${other.id}`, a.owner.cookie)).json();
      expect(detail.holders).toEqual([
        expect.objectContaining({ workerId: worker, status: 'pending' }),
      ]);
      expect((await decide(a.owner.cookie, worker, other.id, 'approve')).json()).toEqual({
        status: 'active',
      });
      expect((await audits(a.companyId, 'worker_skill.approved')).at(-1)).toMatchObject({
        actor_member_id: a.owner.memberId,
        target_id: `${worker}:${other.id}`,
      });
    });
  });

  describe('Kỹ năng có script (6.2, 6.3)', () => {
    it('có scripts/ → rủi ro cao, không giao được cho worker chính thức khi chưa kiểm duyệt (test bắt buộc)', async () => {
      const skill = await approvedSkill(t.app, a.owner.cookie, { scripts: true });
      const detail = (await call(t.app, 'GET', `/api/skills/${skill.id}`, a.owner.cookie)).json();
      expect(detail).toMatchObject({ risk: 'high', hasScripts: true });
      for (const status of ['active', 'suspended'] as const) {
        const worker = await workerIn(t, a, status);
        const res = await assign(t.app, a.owner.cookie, worker, skill.id);
        expect(res.statusCode).toBe(409);
        expect(res.json().error.code).toBe('SKILL_NEEDS_REVIEW');
        expect(await rowsOf(a.companyId, worker)).toEqual([]);
      }
      const probation = await workerIn(t, a, 'probation');
      expect((await assign(t.app, a.admin.cookie, probation, skill.id)).json().status).toBe(
        'pending',
      );
      expect((await decide(a.owner.cookie, probation, skill.id, 'approve')).json().status).toBe(
        'active',
      );
    });

    it('worker Thử việc có kỹ năng script lên Chính thức → Tạm khoá, kỹ năng khác giữ nguyên', async () => {
      const script = await approvedSkill(t.app, a.owner.cookie, { scripts: true });
      const plain = await approvedSkill(t.app, a.owner.cookie);
      const worker = await workerIn(t, a, 'probation');
      await assign(t.app, a.owner.cookie, worker, script.id);
      await decide(a.owner.cookie, worker, script.id, 'approve');
      await assign(t.app, a.owner.cookie, worker, plain.id);
      const res = await transition(t.app, a.owner.cookie, worker, 'activate', 'probation');
      expect(res.statusCode).toBe(200);
      const rows = Object.fromEntries(
        (await rowsOf(a.companyId, worker)).map((r) => [r.skill_id, r.status]),
      );
      expect(rows).toEqual({ [script.id]: 'suspended', [plain.id]: 'active' });
      expect((await audits(a.companyId, 'worker_skill.suspended')).at(-1)?.target_id).toBe(
        `${worker}:${script.id}`,
      );
      const view = await list(a.owner.cookie, worker);
      expect(view.skills.find((s: { skillId: string }) => s.skillId === script.id).status).toBe(
        'suspended',
      );
    });
    it('duyệt version thêm scripts/ → worker Chính thức Tạm khoá, worker Thử việc dùng version mới (#115)', async () => {
      const skill = await approvedSkill(t.app, a.owner.cookie);
      const active = await workerIn(t, a, 'active');
      const probation = await workerIn(t, a, 'probation');
      await assign(t.app, a.owner.cookie, active, skill.id);
      await assign(t.app, a.owner.cookie, probation, skill.id);
      const added = await raw(
        t.app,
        'PUT',
        `/api/skills/${skill.id}/draft/files/scripts/x.py`,
        a.owner.cookie,
        Buffer.from('x=1'),
        'application/octet-stream',
      );
      expect(added.statusCode).toBe(200);
      const { revision } = added.json();
      expect(
        (
          await call(t.app, 'POST', `/api/skills/${skill.id}/draft/submit`, a.owner.cookie, {
            revision,
            proposedRisk: 'high',
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await call(t.app, 'POST', `/api/skills/${skill.id}/versions/2/approve`, a.owner.cookie, {
            risk: 'high',
          })
        ).statusCode,
      ).toBe(200);
      expect(await rowsOf(a.companyId, active)).toEqual([
        { skill_id: skill.id, status: 'suspended' },
      ]);
      expect(await rowsOf(a.companyId, probation)).toEqual([
        { skill_id: skill.id, status: 'active' },
      ]);
    });
  });

  describe('Duyệt, từ chối, gỡ (6.1, 6.2)', () => {
    it('Trưởng phòng tự duyệt yêu cầu → 403, vẫn chờ; Owner từ chối → xoá yêu cầu, AuditEvent', async () => {
      const skill = await approvedSkill(t.app, a.owner.cookie);
      const worker = await workerIn(t, a, 'active');
      await assign(t.app, a.manager.cookie, worker, skill.id);
      expect((await decide(a.manager.cookie, worker, skill.id, 'approve')).statusCode).toBe(403);
      expect(await rowsOf(a.companyId, worker)).toEqual([
        { skill_id: skill.id, status: 'pending' },
      ]);
      expect((await decide(a.owner.cookie, worker, skill.id, 'reject')).json()).toEqual({
        status: 'rejected',
      });
      expect(await rowsOf(a.companyId, worker)).toEqual([]);
      expect((await audits(a.companyId, 'worker_skill.rejected')).at(-1)?.actor_member_id).toBe(
        a.owner.memberId,
      );
    });

    it('Trưởng phòng gỡ kỹ năng khỏi worker phòng mình; Nhân viên gỡ → 403', async () => {
      const skill = await approvedSkill(t.app, a.owner.cookie);
      const worker = await workerIn(t, a, 'probation');
      await assign(t.app, a.manager.cookie, worker, skill.id);
      expect(
        (await raw(t.app, 'DELETE', `/api/workers/${worker}/skills/${skill.id}`, a.member.cookie))
          .statusCode,
      ).toBe(403);
      expect(await rowsOf(a.companyId, worker)).toHaveLength(1);
      expect(
        (await raw(t.app, 'DELETE', `/api/workers/${worker}/skills/${skill.id}`, a.manager.cookie))
          .statusCode,
      ).toBe(200);
      expect(await rowsOf(a.companyId, worker)).toEqual([]);
      expect((await audits(a.companyId, 'worker_skill.removed')).at(-1)?.target_id).toBe(
        `${worker}:${skill.id}`,
      );
    });

    it('Nhân viên xem tab Kỹ năng của worker phòng mình, không của phòng khác', async () => {
      const worker = await workerIn(t, a, 'probation');
      const res = await call(t.app, 'GET', `/api/workers/${worker}/skills`, a.member.cookie);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ canAssign: false, canApprove: false });
      const accounting = await workerIn(t, a, 'probation', a.accountingId);
      expect(
        (await call(t.app, 'GET', `/api/workers/${accounting}/skills`, a.member.cookie)).statusCode,
      ).toBe(403);
    });
  });

  describe('Tách công ty (6.4)', () => {
    it('công ty A giao / gỡ / duyệt phần giao của worker hoặc kỹ năng công ty B → 404', async () => {
      const bSkill = await approvedSkill(t.app, b.owner.cookie);
      const bWorker = await workerIn(t, b, 'active');
      await assign(t.app, b.manager.cookie, bWorker, bSkill.id);
      const aSkill = await approvedSkill(t.app, a.owner.cookie);
      const aWorker = await workerIn(t, a, 'probation');
      const attempts = [
        assign(t.app, a.owner.cookie, bWorker, aSkill.id),
        assign(t.app, a.owner.cookie, aWorker, bSkill.id),
        raw(t.app, 'DELETE', `/api/workers/${bWorker}/skills/${bSkill.id}`, a.owner.cookie),
        decide(a.owner.cookie, bWorker, bSkill.id, 'approve'),
        decide(a.owner.cookie, bWorker, bSkill.id, 'reject'),
        call(t.app, 'GET', `/api/workers/${bWorker}/skills`, a.owner.cookie),
        assign(t.app, a.owner.cookie, randomUUID(), aSkill.id),
      ];
      for (const res of await Promise.all(attempts)) expect(res.statusCode).toBe(404);
      expect(await rowsOf(b.companyId, bWorker)).toEqual([
        { skill_id: bSkill.id, status: 'pending' },
      ]);
      expect(await rowsOf(a.companyId, aWorker)).toEqual([]);
      const detail = (await call(t.app, 'GET', `/api/skills/${aSkill.id}`, a.owner.cookie)).json();
      expect(detail.holders).toEqual([]);
    });
  });
});
