import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { zipSync } from 'fflate';
import { vi } from '../src/i18n/vi.ts';

/** Change 3 end to end (tasks 7.4, 8.3, 7.1 widths): skill library, import, assignment. */

const PASSWORD = 'gom an phu bat trang';
const ORIGIN = 'http://localhost:4173';
const EMAILS = 'http://127.0.0.1:4310/__e2e/emails';
const uniqueEmail = (label: string) =>
  `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));
const enc = (text: string) => new TextEncoder().encode(text);
const zip = (files: Record<string, string>) =>
  Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, enc(v)]))));
const skillMd = (name: string, body = '# Kỹ năng thử\n\nSoạn văn bản.\n') =>
  `---\nname: ${name}\ndescription: Kỹ năng dùng trong kiểm thử.\n---\n${body}`;
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function linkTo(request: APIRequestContext, to: string, pattern: RegExp): Promise<URL> {
  let found = '';
  await expect
    .poll(async () => {
      const res = await request.get(`${EMAILS}?to=${encodeURIComponent(to)}`);
      const emails = (await res.json()) as Array<{ text: string }>;
      const text = [...emails].reverse().find((email) => pattern.test(email.text))?.text ?? '';
      found = text.match(/https?:\/\/\S+/g)?.find((url) => pattern.test(url)) ?? '';
      return found !== '';
    })
    .toBe(true);
  return new URL(found);
}

/** JSON call as the page's signed-in user (same cookies, trusted Origin). */
async function apiCall<T>(page: Page, method: 'GET' | 'POST', path: string, data?: unknown) {
  const res = await page.request.fetch(path, {
    method,
    headers: { origin: ORIGIN },
    ...(data === undefined ? {} : { data }),
  });
  expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

/** Owner signs up, verifies and creates "Kinh doanh"; returns its id. */
async function ownerCompany(page: Page): Promise<string> {
  const ownerEmail = uniqueEmail('owner');
  await page.goto('/signup');
  await page.getByLabel(vi['signup.companyName']).fill('Gốm An Phú');
  await page.getByLabel(vi['signup.name']).fill('Trần Minh Đức');
  await page.getByLabel(vi['signup.email']).fill(ownerEmail);
  await page.getByLabel(vi['signup.password'], { exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox', { name: vi['signup.terms'] }).check();
  await page.getByRole('button', { name: vi['signup.submit'] }).click();
  await expect(page).toHaveURL('/');
  const verify = await linkTo(page.request, ownerEmail, /verify-email/);
  await page.goto(verify.pathname + verify.search);
  await expect(page.getByText(vi['verify.success'])).toBeVisible();
  const created = await apiCall<{ id: string }>(page, 'POST', '/api/departments', {
    name: vi['departments.suggest.sales'],
  });
  return created.id;
}

/** Invites someone with `role` by API and lets them join in a new browser context. */
async function join(
  owner: Page,
  browser: Browser,
  role: 'admin' | 'manager' | 'member',
  departmentId: string | null,
  name: string,
) {
  const email = uniqueEmail(role);
  await apiCall(owner, 'POST', '/api/invitations', { emails: [email], role, departmentId });
  const invite = await linkTo(owner.request, email, /\/invite#token=/);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(invite.pathname + invite.hash);
  await page.getByLabel(vi['signup.name']).fill(name);
  await page.getByLabel(vi['signup.password'], { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: vi['invite.submit'] }).click();
  await expect(page).toHaveURL('/');
  return { page, close: () => context.close() };
}

/** An approved skill (Owner) and an active worker, both through the API. */
async function approvedSkill(owner: Page, name: string): Promise<string> {
  const { id } = await apiCall<{ id: string }>(owner, 'POST', '/api/skills', {
    skillMd: skillMd(name),
  });
  await apiCall(owner, 'POST', `/api/skills/${id}/draft/submit`, {
    revision: 0,
    proposedRisk: 'low',
  });
  await apiCall(owner, 'POST', `/api/skills/${id}/versions/1/approve`, { risk: 'low' });
  return id;
}

async function activeWorker(owner: Page, departmentId: string, name: string): Promise<string> {
  const { id } = await apiCall<{ id: string }>(owner, 'POST', '/api/workers', {
    name,
    departmentId,
    templateId: 'quote-assistant',
  });
  for (const [event, expectedStatus] of [
    ['startProbation', 'draft'],
    ['activate', 'probation'],
  ]) {
    await apiCall(owner, 'POST', `/api/workers/${id}/transitions`, { event, expectedStatus });
  }
  return id;
}

test('Nhân viên dùng mẫu → sửa → gửi duyệt; Admin duyệt; <script> trong SKILL.md chỉ là chữ', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const departmentId = await ownerCompany(page);
  const member = await join(page, browser, 'member', departmentId, 'Đỗ Văn Nam');
  const admin = await join(page, browser, 'admin', null, 'Lê Hoàng Admin');
  const m = member.page;

  await m.getByRole('link', { name: vi['shell.nav.skills'] }).click();
  await expect(m.getByRole('heading', { level: 1, name: vi['skills.title'] })).toBeVisible();
  await m.getByRole('link', { name: vi['skills.tab.templates'] }).click();
  await m.getByRole('button', { name: `${vi['skills.template.use']}: Tóm tắt email` }).click();
  await expect(m.getByRole('heading', { level: 1, name: vi['editor.title'] })).toBeVisible();

  const editor = m.getByLabel(vi['editor.skillMd']);
  await expect(editor).toHaveValue(/name: tom-tat-email/);
  await editor.fill(
    `${await editor.inputValue()}\n<script>window.__pwned = 1</script>\n<img src="https://la.example/x">\n`,
  );
  await m.getByRole('button', { name: vi['editor.save'] }).click();
  await expect(m.getByText(fill(vi['editor.saved'], { n: 1 }))).toBeVisible();
  await m.getByLabel(vi['editor.changeNote']).fill('Thêm ghi chú thử');
  await m.getByRole('button', { name: vi['editor.submit'] }).click();
  await expect(
    m.getByText(fill(vi['skill.notice.pendingNoCurrent'], { pending: 1 })),
  ).toBeVisible();
  // A Member never sees the approve button.
  await expect(
    m.getByRole('button', { name: fill(vi['skill.approveDialog.title'], { n: 1 }) }),
  ).toHaveCount(0);
  const skillUrl = new URL(m.url()).pathname;

  const a = admin.page;
  const outside: string[] = [];
  a.on('request', (request) => {
    if (request.url().includes('la.example')) outside.push(request.url());
  });
  await a.goto(skillUrl);
  const preview = a.getByRole('figure', { name: 'SKILL.md' });
  await expect(preview).toContainText('<script>window.__pwned = 1</script>');
  await expect(preview).toContainText('<img src="https://la.example/x">');
  expect(
    await a.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
  ).toBeUndefined();
  expect(await preview.locator('script, img').count()).toBe(0);
  await a.getByRole('button', { name: fill(vi['skill.approveDialog.title'], { n: 1 }) }).click();
  const dialog = a.getByRole('dialog');
  await dialog.getByLabel(vi['skill.approveDialog.risk']).selectOption('medium');
  await dialog.getByRole('button', { name: vi['skill.approve'], exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(a.getByRole('heading', { level: 1 })).toContainText(vi['skill.status.active']);
  await expect(a.getByText(fill(vi['skills.card.version'], { n: 1 })).first()).toBeVisible();
  expect(outside).toEqual([]);
  await member.close();
  await admin.close();
});

test('nhập zip lỗi thấy lý do; zip có scripts/ cảnh báo rủi ro cao; Trưởng phòng giao → Owner duyệt', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const departmentId = await ownerCompany(page);

  await page.goto('/skills');
  await page.getByRole('button', { name: vi['skills.import'] }).click();
  const dialog = page.getByRole('dialog', { name: vi['import.title'] });
  const picker = dialog.locator('input[type=file]');
  await picker.setInputFiles({
    name: 'bao-gia-cu.zip',
    mimeType: 'application/zip',
    buffer: zip({
      'bao-gia/SKILL.md': '---\nname: lap-bao-gia\n---\n# Báo giá\n',
      'bao-gia/r.md': 'x',
    }),
  });
  const checks = dialog.getByRole('list', { name: vi['import.checks'] });
  await expect(checks).toContainText(vi['check.SKILL_MD_IN_SUBFOLDER']);
  await expect(checks).toContainText('bao-gia/SKILL.md');
  await expect(checks).toContainText(vi['check.DESCRIPTION_MISSING']);
  await expect(dialog.getByRole('button', { name: vi['import.submit'] })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('import-error.png') });

  await picker.setInputFiles({
    name: 'doi-chieu-hoa-don.zip',
    mimeType: 'application/zip',
    buffer: zip({
      'SKILL.md': skillMd('doi-chieu-hoa-don'),
      'scripts/doi_chieu.py': 'print("x")\n',
    }),
  });
  await expect(checks).toContainText(fill(vi['check.HAS_SCRIPTS'], { count: 1 }));
  await expect(checks).toContainText(vi['check.HAS_SCRIPTS.fix']);
  await page.screenshot({ path: testInfo.outputPath('import.png') });
  await dialog.getByRole('button', { name: vi['import.submit'] }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Kỹ năng thử');
  await expect(page.getByText(vi['skill.hasScripts']).first()).toBeVisible();
  await expect(page.getByText(vi['risk.high']).first()).toBeVisible();

  // Trưởng phòng gives an approved skill to an active worker → waits for Owner / Admin.
  const skillId = await approvedSkill(page, 'tom-tat-email-thu');
  const workerId = await activeWorker(page, departmentId, 'Minh · Báo giá');
  const manager = await join(page, browser, 'manager', departmentId, 'Nguyễn Thị Lan');
  await manager.page.goto(`/skills/${skillId}`);
  await manager.page.getByRole('button', { name: vi['holders.assign'] }).click();
  const assign = manager.page.getByRole('dialog', { name: vi['assign.title'] });
  await assign
    .getByLabel(vi['assign.worker'])
    .selectOption({ label: 'Minh · Báo giá · Kinh doanh' });
  await expect(assign.getByText(vi['assign.willRequest'])).toBeVisible();
  await assign.getByRole('button', { name: vi['assign.submit'] }).click();
  await expect(manager.page.getByText(vi['assign.done.pending'])).toBeVisible();
  const holders = manager.page.getByRole('region', { name: vi['holders.title'] });
  await expect(holders).toContainText(vi['assign.status.pending']);

  await page.goto(`/workers/${workerId}`);
  await page.getByRole('tab', { name: vi['profile.tab.skills'] }).click();
  const tab = page.getByRole('region', { name: vi['workerSkills.title'] });
  await expect(tab).toContainText(vi['assign.status.pending']);
  await tab.getByRole('button', { name: vi['assign.approve'] }).click();
  await expect(tab).toContainText(vi['assign.status.active']);
  await expect(tab).toContainText(fill(vi['holders.version'], { n: 1 }));
  await manager.close();
});

test('thư viện và chi tiết kỹ năng không tràn ngang ở 320 / 768 / 1024 / 1440 px (ảnh chụp)', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await ownerCompany(page);
  const id = await approvedSkill(page, 'lap-bao-gia-rong');
  await apiCall(page, 'POST', '/api/skill-templates/lap-bao-gia/use');
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/skills?risk=low');
    await expect(page.getByRole('link', { name: 'Kỹ năng thử' })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/risk=low/);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath(`library-${width}.png`), fullPage: true });
    await page.goto('/skills?tab=templates');
    await expect(page.getByText('Lập báo giá').first()).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.goto(`/skills/${id}`);
    await expect(page.getByRole('heading', { name: vi['skill.history'] })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath(`detail-${width}.png`), fullPage: true });
  }
});
