import { randomUUID } from 'node:crypto';
import { unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditEventsOf,
  type Harness,
  makeApp,
  startHarness,
  type TestApp,
} from './support/harness.ts';
import { call, type OrgTenant, seedOrg, sqlIn } from './support/org.ts';
import {
  approve,
  approvedSkill,
  assign,
  createSkill,
  detailOf,
  edit,
  raw,
  skillMd,
  skillName,
  submit,
  zipOf,
} from './support/skills.ts';
import { workerIn } from './support/workers.ts';

describe('skill library (specs skill-library, skill-package)', () => {
  let harness: Harness;
  let t: TestApp;
  let a: OrgTenant;
  let b: OrgTenant;

  const audits = async (companyId: string, action: string) =>
    (await auditEventsOf(harness, companyId)).filter((event) => event.action === action);
  const versionRow = async (companyId: string, skillId: string, n: number) =>
    (
      await sqlIn(
        harness,
        companyId,
        'select status, risk, reject_reason, decided_by_member_id from skill_versions where skill_id = $1 and number = $2',
        [skillId, n],
      )
    )[0];
  const effective = async (companyId: string, workerId: string) =>
    sqlIn(
      harness,
      companyId,
      `select s.id, v.number from worker_skills ws join skills s on s.id = ws.skill_id
         join skill_versions v on v.id = s.current_version_id
        where ws.worker_id = $1 and ws.status = 'active'`,
      [workerId],
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

  describe('Tạo kỹ năng, xem thư viện (4.1, 4.2)', () => {
    it('Nhân viên tạo kỹ năng → Nháp, v1 là bản nháp, người tạo là Nhân viên, AuditEvent', async () => {
      const name = skillName();
      const id = await createSkill(t.app, a.member.cookie, skillMd(name));
      const view = await detailOf(t.app, a.member.cookie, id);
      expect(view).toMatchObject({
        name,
        title: 'Lập báo giá',
        status: 'draft',
        draftNumber: 1,
        currentNumber: null,
        draftRevision: 0,
        risk: 'low',
      });
      expect(view.versions[0]).toMatchObject({
        number: 1,
        status: 'draft',
        createdBy: { id: a.member.memberId },
      });
      expect((await audits(a.companyId, 'skill.created')).at(-1)).toMatchObject({
        actor_member_id: a.member.memberId,
        target_type: 'skill',
        target_id: id,
      });
    });

    it('trùng name chưa lưu trữ → 409 NAME_TAKEN, không tạo gì; công ty khác thì không trùng', async () => {
      const name = skillName();
      await createSkill(t.app, a.owner.cookie, skillMd(name));
      const dup = await call(t.app, 'POST', '/api/skills', a.manager.cookie, {
        skillMd: skillMd(name),
      });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().error.code).toBe('NAME_TAKEN');
      const other = await call(t.app, 'POST', '/api/skills', b.owner.cookie, {
        skillMd: skillMd(name),
      });
      expect(other.statusCode).toBe(201);
      const rows = await sqlIn(
        harness,
        a.companyId,
        'select count(*)::int as n from skills where name = $1',
        [name],
      );
      expect(rows[0]).toEqual({ n: 1 });
    });

    it('SKILL.md sai → 422 với danh sách kiểm tra; companyId trong body bị từ chối', async () => {
      const res = await call(t.app, 'POST', '/api/skills', a.owner.cookie, {
        skillMd: '---\nname: Lập-Báo-Giá\n---\n',
      });
      expect(res.statusCode).toBe(422);
      const codes = res.json().error.details.checks.map((c: { check: string }) => c.check);
      expect(codes).toEqual(expect.arrayContaining(['NAME_FORMAT', 'DESCRIPTION_MISSING']));
      const smuggled = await call(t.app, 'POST', '/api/skills', a.owner.cookie, {
        skillMd: skillMd(skillName()),
        companyId: b.companyId,
      });
      expect(smuggled.statusCode).toBe(400);
    });

    it('thư viện: thấy kỹ năng công ty mình, lọc rủi ro, tìm, ẩn lưu trữ; không thấy công ty B', async () => {
      const high = await approvedSkill(t.app, a.owner.cookie, { scripts: true });
      const low = await approvedSkill(t.app, a.owner.cookie);
      const secret = await approvedSkill(t.app, b.owner.cookie, { name: skillName('bi-mat') });
      const list = (await call(t.app, 'GET', '/api/skills', a.member.cookie)).json().skills;
      const ids = list.map((s: { id: string }) => s.id);
      expect(ids).toEqual(expect.arrayContaining([high.id, low.id]));
      expect(ids).not.toContain(secret.id);
      const card = list.find((s: { id: string }) => s.id === high.id);
      expect(card).toMatchObject({
        status: 'active',
        currentNumber: 1,
        risk: 'high',
        hasScripts: true,
        workerCount: 0,
      });
      const filtered = (await call(t.app, 'GET', '/api/skills?risk=high', a.member.cookie)).json()
        .skills;
      expect(filtered.every((s: { risk: string }) => s.risk === 'high')).toBe(true);
      expect(filtered.map((s: { id: string }) => s.id)).toContain(high.id);
      const found = (await call(t.app, 'GET', `/api/skills?q=${low.name}`, a.member.cookie)).json()
        .skills;
      expect(found.map((s: { id: string }) => s.id)).toEqual([low.id]);
      await call(t.app, 'POST', `/api/skills/${low.id}/archive`, a.owner.cookie);
      const after = (await call(t.app, 'GET', '/api/skills', a.member.cookie)).json().skills;
      expect(after.map((s: { id: string }) => s.id)).not.toContain(low.id);
      const archived = (
        await call(t.app, 'GET', '/api/skills?archived=true', a.member.cookie)
      ).json().skills;
      expect(archived.map((s: { id: string }) => s.id)).toContain(low.id);
    });

    it('id công ty B → 404 như id không tồn tại + access.not_found', async () => {
      const { id } = await approvedSkill(t.app, b.owner.cookie);
      const theirs = await call(t.app, 'GET', `/api/skills/${id}`, a.owner.cookie);
      const missing = await call(t.app, 'GET', `/api/skills/${randomUUID()}`, a.owner.cookie);
      expect(theirs.statusCode).toBe(404);
      expect(theirs.body).toBe(missing.body);
      expect(
        (await call(t.app, 'GET', `/api/skills/${id}/versions/1`, a.owner.cookie)).statusCode,
      ).toBe(404);
      expect((await audits(a.companyId, 'access.not_found')).some((e) => e.target_id === id)).toBe(
        true,
      );
    });
  });

  describe('Sửa, gửi duyệt, duyệt (4.2, 4.3)', () => {
    it('sửa tạo version mới; 3 worker giữ v1 tới khi duyệt; duyệt xong cả 3 dùng v2 (test bắt buộc)', async () => {
      const skill = await approvedSkill(t.app, a.owner.cookie);
      const workers = [
        await workerIn(t, a, 'probation'),
        await workerIn(t, a, 'active'),
        await workerIn(t, a, 'draft'),
      ];
      for (const worker of workers) {
        expect((await assign(t.app, a.owner.cookie, worker, skill.id)).statusCode).toBe(201);
      }
      const saved = await edit(
        t.app,
        a.manager.cookie,
        skill.id,
        skillMd(skill.name, '# Lập báo giá\n\nThêm bước kiểm tra.\n'),
      );
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({ number: 2, revision: 1 });
      const view = await detailOf(t.app, a.owner.cookie, skill.id);
      expect(view).toMatchObject({ currentNumber: 1, draftNumber: 2 });
      expect((await submit(t.app, a.manager.cookie, skill.id, 'low', 'Thêm bước')).statusCode).toBe(
        200,
      );
      for (const worker of workers)
        expect(await effective(a.companyId, worker)).toEqual([{ id: skill.id, number: 1 }]);
      const v2 = (
        await call(t.app, 'GET', `/api/skills/${skill.id}/versions/2`, a.member.cookie)
      ).json();
      expect(v2).toMatchObject({ status: 'pending', comparedTo: 1, changeNote: 'Thêm bước' });
      expect(v2.skillMd).toContain('Thêm bước kiểm tra.');
      expect((await approve(t.app, a.admin.cookie, skill.id, 2, 'medium')).statusCode).toBe(200);
      for (const worker of workers)
        expect(await effective(a.companyId, worker)).toEqual([{ id: skill.id, number: 2 }]);
      expect(await versionRow(a.companyId, skill.id, 2)).toMatchObject({
        status: 'approved',
        risk: 'medium',
        decided_by_member_id: a.admin.memberId,
      });
      const approved = (await audits(a.companyId, 'skill.version_approved')).at(-1);
      expect(approved).toMatchObject({
        actor_member_id: a.admin.memberId,
        target_type: 'skill_version',
        fields: ['risk', 'current_version_id'],
      });
    });

    it('hai người cùng sửa → lần lưu sau bị 409 DRAFT_CHANGED, nội dung người đầu giữ nguyên', async () => {
      const skill = await approvedSkill(t.app, a.owner.cookie);
      const first = await call(t.app, 'PUT', `/api/skills/${skill.id}/draft`, a.owner.cookie, {
        skillMd: skillMd(skill.name, '# Bản của Owner\n'),
        revision: null,
      });
      expect(first.statusCode).toBe(200);
      const second = await call(t.app, 'PUT', `/api/skills/${skill.id}/draft`, a.manager.cookie, {
        skillMd: skillMd(skill.name, '# Bản của Trưởng phòng\n'),
        revision: null,
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().error.code).toBe('DRAFT_CHANGED');
      const v2 = (
        await call(t.app, 'GET', `/api/skills/${skill.id}/versions/2`, a.owner.cookie)
      ).json();
      expect(v2.title).toBe('Bản của Owner');
    });

    it('đổi name → 400 NAME_IMMUTABLE; version đã gửi duyệt không sửa được', async () => {
      const skill = await approvedSkill(t.app, a.owner.cookie);
      const renamed = await edit(t.app, a.owner.cookie, skill.id, skillMd('ten-khac-han'));
      expect(renamed.statusCode).toBe(400);
      expect(renamed.json().error.code).toBe('NAME_IMMUTABLE');
      // v1 is approved: an edit opens v2 instead of touching v1.
      await edit(t.app, a.owner.cookie, skill.id, skillMd(skill.name, '# Mới\n'));
      const v1 = (
        await call(t.app, 'GET', `/api/skills/${skill.id}/versions/1`, a.owner.cookie)
      ).json();
      expect(v1.title).toBe('Lập báo giá');
    });

    it('gửi duyệt v3 khi v2 đang chờ → v2 Đã thay, không duyệt được, version đang dùng không đổi', async () => {
      const skill = await approvedSkill(t.app, a.owner.cookie);
      await edit(t.app, a.member.cookie, skill.id, skillMd(skill.name, '# v2\n'));
      await submit(t.app, a.member.cookie, skill.id);
      await edit(t.app, a.member.cookie, skill.id, skillMd(skill.name, '# v3\n'));
      expect((await submit(t.app, a.member.cookie, skill.id)).statusCode).toBe(200);
      expect((await versionRow(a.companyId, skill.id, 2))?.status).toBe('superseded');
      expect((await versionRow(a.companyId, skill.id, 3))?.status).toBe('pending');
      const late = await approve(t.app, a.owner.cookie, skill.id, 2);
      expect(late.statusCode).toBe(409);
      expect(late.json().error.code).toBe('VERSION_NOT_PENDING');
      expect((await detailOf(t.app, a.owner.cookie, skill.id)).currentNumber).toBe(1);
    });

    it('Trưởng phòng / Nhân viên duyệt, từ chối, quay lại, lưu trữ → 403 + access.denied', async () => {
      const skill = await approvedSkill(t.app, a.owner.cookie);
      await edit(t.app, a.manager.cookie, skill.id, skillMd(skill.name, '# v2\n'));
      await submit(t.app, a.manager.cookie, skill.id);
      for (const person of [a.manager, a.member]) {
        const before = (await audits(a.companyId, 'access.denied')).length;
        const calls = [
          approve(t.app, person.cookie, skill.id, 2),
          call(t.app, 'POST', `/api/skills/${skill.id}/versions/2/reject`, person.cookie, {
            reason: 'x',
          }),
          call(t.app, 'POST', `/api/skills/${skill.id}/rollback`, person.cookie, {
            versionNumber: 1,
          }),
          call(t.app, 'POST', `/api/skills/${skill.id}/archive`, person.cookie),
        ];
        for (const res of await Promise.all(calls)) expect(res.statusCode).toBe(403);
        expect((await audits(a.companyId, 'access.denied')).length).toBe(before + 4);
      }
      expect((await versionRow(a.companyId, skill.id, 2))?.status).toBe('pending');
    });

    it('từ chối: bắt buộc lý do; có lý do → Từ chối, worker vẫn dùng v1, AuditEvent không chứa lý do', async () => {
      const skill = await approvedSkill(t.app, a.owner.cookie);
      await edit(t.app, a.owner.cookie, skill.id, skillMd(skill.name, '# v2\n'));
      await submit(t.app, a.owner.cookie, skill.id);
      const blank = await call(
        t.app,
        'POST',
        `/api/skills/${skill.id}/versions/2/reject`,
        a.owner.cookie,
        { reason: ' ' },
      );
      expect(blank.statusCode).toBe(400);
      expect((await versionRow(a.companyId, skill.id, 2))?.status).toBe('pending');
      const res = await call(
        t.app,
        'POST',
        `/api/skills/${skill.id}/versions/2/reject`,
        a.owner.cookie,
        {
          reason: 'chiết khấu sai',
        },
      );
      expect(res.statusCode).toBe(200);
      expect(await versionRow(a.companyId, skill.id, 2)).toMatchObject({
        status: 'rejected',
        reject_reason: 'chiết khấu sai',
      });
      expect((await detailOf(t.app, a.owner.cookie, skill.id)).currentNumber).toBe(1);
      const all = JSON.stringify(await auditEventsOf(harness, a.companyId));
      expect(all).not.toContain('chiết khấu sai');
      expect(all).not.toContain('# v2');
    });

    it('rủi ro: gợi ý thấp cho kỹ năng chỉ soạn văn bản; kỹ năng có script không hạ được', async () => {
      const name = skillName();
      const id = await createSkill(t.app, a.member.cookie, skillMd(name));
      expect((await detailOf(t.app, a.member.cookie, id)).versions[0].suggestedRisk).toBe('low');
      const script = await raw(
        t.app,
        'PUT',
        `/api/skills/${id}/draft/files/scripts/a.py?revision=0`,
        a.member.cookie,
        Buffer.from('x=1'),
        'application/octet-stream',
      );
      expect(script.json()).toMatchObject({ hasScripts: true, suggestedRisk: 'high' });
      const lowered = await submit(t.app, a.member.cookie, id, 'medium');
      expect(lowered.statusCode).toBe(400);
      expect(lowered.json().error.code).toBe('SCRIPT_RISK_HIGH');
      expect((await submit(t.app, a.member.cookie, id, 'high')).statusCode).toBe(200);
      const approveLow = await approve(t.app, a.admin.cookie, id, 1, 'medium');
      expect(approveLow.statusCode).toBe(400);
      expect((await versionRow(a.companyId, id, 1))?.status).toBe('pending');
    });

    it('quay lại v1: v1 đang dùng ngay cho mọi worker; version chưa duyệt không là đích', async () => {
      const skill = await approvedSkill(t.app, a.owner.cookie);
      const worker = await workerIn(t, a, 'probation');
      await assign(t.app, a.owner.cookie, worker, skill.id);
      await edit(t.app, a.owner.cookie, skill.id, skill.name ? skillMd(skill.name, '# v2\n') : '');
      await submit(t.app, a.owner.cookie, skill.id);
      await approve(t.app, a.owner.cookie, skill.id, 2);
      await edit(t.app, a.owner.cookie, skill.id, skillMd(skill.name, '# v3\n'));
      const notApproved = await call(
        t.app,
        'POST',
        `/api/skills/${skill.id}/rollback`,
        a.owner.cookie,
        { versionNumber: 3 },
      );
      expect(notApproved.statusCode).toBe(409);
      const res = await call(t.app, 'POST', `/api/skills/${skill.id}/rollback`, a.owner.cookie, {
        versionNumber: 1,
      });
      expect(res.statusCode).toBe(200);
      expect(await effective(a.companyId, worker)).toEqual([{ id: skill.id, number: 1 }]);
      expect((await audits(a.companyId, 'skill.rolled_back')).at(-1)).toMatchObject({
        actor_member_id: a.owner.memberId,
        target_id: skill.id,
      });
    });

    it('lưu trữ: còn 2 worker → 409 với số 2; gỡ hết → Lưu trữ và name dùng lại được', async () => {
      const skill = await approvedSkill(t.app, a.owner.cookie);
      const w1 = await workerIn(t, a, 'probation');
      const w2 = await workerIn(t, a, 'draft');
      await assign(t.app, a.owner.cookie, w1, skill.id);
      await assign(t.app, a.owner.cookie, w2, skill.id);
      const busy = await call(t.app, 'POST', `/api/skills/${skill.id}/archive`, a.admin.cookie);
      expect(busy.statusCode).toBe(409);
      expect(busy.json().error.details).toMatchObject({ count: 2 });
      for (const w of [w1, w2])
        await raw(t.app, 'DELETE', `/api/workers/${w}/skills/${skill.id}`, a.owner.cookie);
      expect(
        (await call(t.app, 'POST', `/api/skills/${skill.id}/archive`, a.admin.cookie)).statusCode,
      ).toBe(200);
      expect((await detailOf(t.app, a.owner.cookie, skill.id)).status).toBe('archived');
      expect(
        (await edit(t.app, a.owner.cookie, skill.id, skillMd(skill.name))).json().error.code,
      ).toBe('SKILL_ARCHIVED');
      await createSkill(t.app, a.owner.cookie, skillMd(skill.name));
    });
  });

  describe('Tách công ty cho mọi route nhóm 4 (4.4)', () => {
    it('công ty A đọc / sửa / gửi duyệt / duyệt / quay lại / lưu trữ kỹ năng B → 404, B không đổi', async () => {
      const skill = await approvedSkill(t.app, b.owner.cookie);
      await edit(t.app, b.owner.cookie, skill.id, skillMd(skill.name, '# v2 của B\n'));
      await submit(t.app, b.owner.cookie, skill.id);
      const attempts = [
        call(t.app, 'GET', `/api/skills/${skill.id}`, a.owner.cookie),
        call(t.app, 'PUT', `/api/skills/${skill.id}/draft`, a.owner.cookie, {
          skillMd: skillMd(skill.name),
          revision: null,
        }),
        call(t.app, 'POST', `/api/skills/${skill.id}/draft/submit`, a.owner.cookie, {
          revision: 0,
          proposedRisk: 'low',
        }),
        approve(t.app, a.owner.cookie, skill.id, 2),
        call(t.app, 'POST', `/api/skills/${skill.id}/versions/2/reject`, a.owner.cookie, {
          reason: 'x',
        }),
        call(t.app, 'POST', `/api/skills/${skill.id}/rollback`, a.owner.cookie, {
          versionNumber: 1,
        }),
        call(t.app, 'POST', `/api/skills/${skill.id}/archive`, a.owner.cookie),
        call(t.app, 'GET', `/api/skills/${skill.id}/export`, a.owner.cookie),
        call(t.app, 'GET', `/api/skills/${skill.id}/versions/1/files/SKILL.md`, a.owner.cookie),
      ];
      for (const res of await Promise.all(attempts)) expect(res.statusCode).toBe(404);
      const view = await detailOf(t.app, b.owner.cookie, skill.id);
      expect(view).toMatchObject({ currentNumber: 1, pendingNumber: 2, status: 'active' });
    });
  });

  describe('Nhập zip (5.1)', () => {
    const importZip = (cookie: string, zip: Buffer, dryRun = false) =>
      raw(t.app, 'POST', `/api/skills/import${dryRun ? '?dryRun=1' : ''}`, cookie, zip);
    const codes = (res: { json: () => { error: { details: { checks: { check: string }[] } } } }) =>
      res.json().error.details.checks.map((c) => c.check);

    it('nhập zip sai định dạng bị từ chối với lý do rõ, không tạo gì (test bắt buộc)', async () => {
      const before = await sqlIn(harness, a.companyId, 'select count(*)::int as n from skills');
      const cases: Array<[Buffer, string]> = [
        [
          zipOf({ 'bao-gia/SKILL.md': skillMd('lap-bao-gia-x'), 'bao-gia/r.md': 'x' }),
          'SKILL_MD_IN_SUBFOLDER',
        ],
        [zipOf({ 'readme.md': 'x' }), 'ROOT_SKILL_MD'],
        [zipOf({ 'SKILL.md': '---\nname: thieu-mo-ta\n---\n' }), 'DESCRIPTION_MISSING'],
        [
          zipOf({
            'SKILL.md': skillMd(skillName()),
            'tools/setup.exe': new Uint8Array([0x4d, 0x5a]),
          }),
          'FILE_TYPE',
        ],
        [zipOf({ 'SKILL.md': skillMd(skillName()), '../../etc/passwd': 'root' }), 'PATH_UNSAFE'],
        [Buffer.from('không phải zip'), 'ZIP_INVALID'],
      ];
      for (const [zip, code] of cases) {
        const res = await importZip(a.member.cookie, zip);
        expect(res.statusCode).toBe(422);
        expect(res.json().error.code).toBe('PACKAGE_INVALID');
        expect(codes(res)).toContain(code);
      }
      const bad = await importZip(a.member.cookie, cases[3]?.[0] ?? Buffer.alloc(0));
      expect(bad.json().error.details.checks).toContainEqual({
        check: 'FILE_TYPE',
        level: 'error',
        path: 'tools/setup.exe',
      });
      expect(await sqlIn(harness, a.companyId, 'select count(*)::int as n from skills')).toEqual(
        before,
      );
    });

    it('quá 25 MB → 413 PACKAGE_TOO_LARGE', async () => {
      const res = await importZip(a.member.cookie, Buffer.alloc(26 * 1024 * 1024));
      expect(res.statusCode).toBe(413);
      expect(res.json().error.code).toBe('PACKAGE_TOO_LARGE');
    });

    it('thư mục trùng name + rác macOS: dryRun chỉ kiểm, nhập thật tạo Nháp với đúng 2 file và AuditEvent', async () => {
      const name = skillName();
      const zip = zipOf({
        [`${name}/SKILL.md`]: skillMd(name),
        [`${name}/references/bang-gia.md`]: '# Bảng giá',
        '__MACOSX/._x': 'junk',
        [`${name}/.DS_Store`]: 'junk',
      });
      const dry = await importZip(a.member.cookie, zip, true);
      expect(dry.statusCode).toBe(200);
      expect(dry.json()).toMatchObject({
        ok: true,
        summary: { name, fileCount: 2, hasScripts: false },
      });
      expect(dry.json().checks.map((c: { check: string }) => c.check)).toContain('NAME_AVAILABLE');
      expect(
        await sqlIn(harness, a.companyId, 'select id from skills where name = $1', [name]),
      ).toEqual([]);
      const res = await importZip(a.member.cookie, zip);
      expect(res.statusCode).toBe(201);
      const id = res.json().id;
      const v1 = (await call(t.app, 'GET', `/api/skills/${id}/versions/1`, a.member.cookie)).json();
      expect(v1.status).toBe('draft');
      expect(v1.files.map((f: { path: string }) => f.path)).toEqual([
        'SKILL.md',
        'references/bang-gia.md',
      ]);
      expect((await audits(a.companyId, 'skill.imported')).at(-1)).toMatchObject({
        actor_member_id: a.member.memberId,
        target_id: id,
      });
      const again = await importZip(a.member.cookie, zip);
      expect(codes(again)).toContain('NAME_TAKEN');
    });

    it('zip có scripts/ được nhận, cảnh báo rủi ro cao', async () => {
      const name = skillName();
      const res = await importZip(
        a.member.cookie,
        zipOf({ 'SKILL.md': skillMd(name), 'scripts/doi_chieu.py': 'print(1)' }),
      );
      expect(res.statusCode).toBe(201);
      expect(res.json().checks).toContainEqual({
        check: 'HAS_SCRIPTS',
        level: 'warn',
        params: { count: 1 },
      });
      expect((await detailOf(t.app, a.member.cookie, res.json().id)).risk).toBe('high');
    });

    it('nhập không lẫn công ty: name trùng kỹ năng công ty B vẫn tạo ở A, B không đổi', async () => {
      const { name, id } = await approvedSkill(t.app, b.owner.cookie);
      const res = await importZip(a.member.cookie, zipOf({ 'SKILL.md': skillMd(name) }));
      expect(res.statusCode).toBe(201);
      expect((await detailOf(t.app, b.owner.cookie, id)).status).toBe('active');
    });

    it('chỉ route nhập / file nhận thân zip thô', async () => {
      const res = await raw(
        t.app,
        'POST',
        '/api/skills',
        a.member.cookie,
        zipOf({ 'SKILL.md': 'x' }),
      );
      expect(res.statusCode).toBe(415);
    });
  });

  describe('File, xuất, mẫu (5.2–5.4)', () => {
    it('tải lên .svg bị từ chối; tải xuống là attachment, nosniff, không text/html', async () => {
      const skill = await approvedSkill(t.app, a.owner.cookie);
      const svg = await raw(
        t.app,
        'PUT',
        `/api/skills/${skill.id}/draft/files/assets/logo.svg`,
        a.owner.cookie,
        Buffer.from('<svg onload="x"/>'),
        'application/octet-stream',
      );
      expect(svg.statusCode).toBe(422);
      expect(svg.json().error.details.checks[0]).toMatchObject({
        check: 'FILE_TYPE',
        path: 'assets/logo.svg',
      });
      const file = await call(
        t.app,
        'GET',
        `/api/skills/${skill.id}/versions/1/files/SKILL.md`,
        a.member.cookie,
      );
      expect(file.statusCode).toBe(200);
      expect(file.headers['content-disposition']).toMatch(/^attachment; filename="SKILL.md"/);
      expect(file.headers['x-content-type-options']).toBe('nosniff');
      expect(file.headers['content-type']).toMatch(/^text\/markdown/);
      expect(file.body).toContain(`name: ${skill.name}`);
    });

    it('xóa file đi kèm làm has_scripts và rủi ro gợi ý cập nhật', async () => {
      const skill = await approvedSkill(t.app, a.owner.cookie, { scripts: true });
      const { draftRevision } = await detailOf(t.app, a.owner.cookie, skill.id);
      const res = await raw(
        t.app,
        'DELETE',
        `/api/skills/${skill.id}/draft/files/scripts/doi_chieu.py${draftRevision === null ? '' : `?revision=${draftRevision}`}`,
        a.owner.cookie,
      );
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ number: 2, hasScripts: false, suggestedRisk: 'low' });
    });

    it('xuất rồi lưu trữ, nhập lại → cùng SKILL.md và cùng file; AuditEvent skill.exported', async () => {
      const name = skillName();
      const imported = await raw(
        t.app,
        'POST',
        '/api/skills/import',
        a.owner.cookie,
        zipOf({
          'SKILL.md': skillMd(name),
          'references/a.md': '# A',
          'assets/x.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
        }),
      );
      const id = imported.json().id;
      await submit(t.app, a.owner.cookie, id);
      await approve(t.app, a.owner.cookie, id, 1);
      const exported = await t.app.inject({
        method: 'GET',
        url: `/api/skills/${id}/export`,
        headers: { cookie: a.owner.cookie },
      });
      expect(exported.statusCode).toBe(200);
      expect(exported.headers['content-disposition']).toContain(`${name}-v1.zip`);
      const files = unzipSync(new Uint8Array(exported.rawPayload));
      expect(Object.keys(files).sort()).toEqual(['SKILL.md', 'assets/x.png', 'references/a.md']);
      expect((await audits(a.companyId, 'skill.exported')).length).toBeGreaterThan(0);
      await call(t.app, 'POST', `/api/skills/${id}/archive`, a.owner.cookie);
      const again = await raw(
        t.app,
        'POST',
        '/api/skills/import',
        a.owner.cookie,
        exported.rawPayload,
      );
      expect(again.statusCode).toBe(201);
      const v1 = (
        await call(t.app, 'GET', `/api/skills/${again.json().id}/versions/1`, a.owner.cookie)
      ).json();
      const old = (await call(t.app, 'GET', `/api/skills/${id}/versions/1`, a.owner.cookie)).json();
      expect(v1.skillMd).toBe(old.skillMd);
      expect(v1.files).toEqual(old.files);
    });

    it('mẫu: 10 mẫu; Dùng mẫu tạo Nháp sửa được; trùng → 409; công ty B không thấy', async () => {
      const list = (await call(t.app, 'GET', '/api/skill-templates', a.member.cookie)).json()
        .templates;
      expect(list).toHaveLength(10);
      expect(list[0]).toMatchObject({ name: 'lap-bao-gia', title: 'Lập báo giá' });
      const used = await call(
        t.app,
        'POST',
        '/api/skill-templates/tom-tat-email/use',
        a.manager.cookie,
      );
      expect(used.statusCode).toBe(201);
      const id = used.json().id;
      expect((await detailOf(t.app, a.manager.cookie, id)).status).toBe('draft');
      expect(
        (
          await edit(
            t.app,
            a.manager.cookie,
            id,
            skillMd('tom-tat-email', '# Tóm tắt email của A\n'),
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await call(t.app, 'POST', '/api/skill-templates/tom-tat-email/use', a.member.cookie)
        ).json().error.code,
      ).toBe('NAME_TAKEN');
      const bList = (await call(t.app, 'GET', '/api/skills', b.owner.cookie)).json().skills;
      expect(bList.map((s: { id: string }) => s.id)).not.toContain(id);
      const bTemplates = (await call(t.app, 'GET', '/api/skill-templates', b.owner.cookie)).json()
        .templates;
      expect(bTemplates.find((tpl: { name: string }) => tpl.name === 'tom-tat-email').title).toBe(
        'Tóm tắt email',
      );
      expect((await audits(a.companyId, 'skill.created_from_template')).at(-1)?.target_id).toBe(id);
      expect(
        (await call(t.app, 'POST', '/api/skill-templates/khong-co/use', a.member.cookie))
          .statusCode,
      ).toBe(404);
    });
  });
});
