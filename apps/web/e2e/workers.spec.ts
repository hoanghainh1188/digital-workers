import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { vi } from '../src/i18n/vi.ts';

/** Change 2 end to end (tasks 6.2–6.4): org chart, worker profile, lifecycle. */

const PASSWORD = 'gom an phu bat trang';
const EMAILS = 'http://127.0.0.1:4310/__e2e/emails';
const uniqueEmail = (label: string) =>
  `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));

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

/** Owner signs up and verifies, creates "Kinh doanh", invites a Manager who joins. */
async function companyWithManager(page: Page, browser: Browser) {
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

  await page.goto('/departments');
  await page.getByRole('button', { name: vi['departments.suggest.sales'] }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: vi['departments.suggest.sales'] }),
  ).toBeVisible();

  const managerEmail = uniqueEmail('lan');
  await page.goto('/users');
  await page.getByRole('button', { name: vi['users.invite'] }).click();
  const dialog = page.getByRole('dialog', { name: vi['invites.title'] });
  await dialog.getByLabel(vi['invites.emails']).fill(managerEmail);
  await dialog.getByLabel(vi['invites.emails']).press('Enter');
  await dialog.getByRole('radio', { name: new RegExp(vi['role.manager']) }).check();
  await dialog
    .getByLabel(vi['invites.department'])
    .selectOption({ label: vi['departments.suggest.sales'] });
  await dialog.getByRole('button', { name: 'Gửi 1 lời mời' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Đã gửi 1 lời mời.' })).toBeVisible();

  const invite = await linkTo(page.request, managerEmail, /\/invite#token=/);
  const context = await browser.newContext();
  const manager = await context.newPage();
  await manager.goto(invite.pathname + invite.hash);
  await manager.getByLabel(vi['signup.name']).fill('Nguyễn Thị Lan');
  await manager.getByLabel(vi['signup.password'], { exact: true }).fill(PASSWORD);
  await manager.getByRole('button', { name: vi['invite.submit'] }).click();
  await expect(manager).toHaveURL('/');
  return { manager, close: () => context.close() };
}

async function act(page: Page, action: string, fields: Record<string, string> = {}) {
  await page.getByRole('button', { name: action, exact: true }).first().click();
  const dialog = page.getByRole('dialog').or(page.getByRole('alertdialog'));
  for (const [label, value] of Object.entries(fields)) {
    await dialog.getByLabel(new RegExp(label)).fill(value);
  }
  await dialog.getByRole('button', { name: action, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

const badge = (page: Page) => page.getByRole('heading', { level: 1 }).locator('.worker-status');
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('Manager hires from a template → probation → proposes → Owner approves → suspend → resume → offboard', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const { manager, close } = await companyWithManager(page, browser);

  // Empty company: the invitation with three templates.
  await manager.getByRole('link', { name: vi['shell.nav.orgChart'] }).click();
  await expect(manager.getByRole('heading', { name: vi['workers.empty.title'] })).toBeVisible();
  await manager
    .getByRole('button', { name: new RegExp(vi['template.quote-assistant.title']) })
    .click();
  const hire = manager.getByRole('dialog', { name: vi['hire.title'] });
  await expect(hire.getByLabel(vi['hire.name'])).toHaveValue(vi['template.quote-assistant.title']);
  await hire.getByLabel(vi['hire.name']).fill('Minh · Báo giá');
  await expect(hire.getByText(vi['hire.department.managerHint'])).toBeVisible();
  await hire.getByRole('button', { name: vi['hire.submit'] }).click();

  // Draft profile: description from the template, 300.000đ.
  await expect(manager.getByRole('heading', { level: 1 })).toContainText('Minh · Báo giá');
  await expect(badge(manager)).toHaveText(vi['worker.status.draft']);
  await expect(manager.getByText('Ngân sách 300.000đ / tháng')).toBeVisible();
  await expect(manager.getByLabel(vi['profile.form.job'])).toHaveValue(/báo giá/);

  await act(manager, vi['action.startProbation']);
  await expect(badge(manager)).toHaveText('Thử việc · ngày 1/14');
  await expect(manager.getByRole('heading', { name: vi['probation.title'] })).toBeVisible();
  // A Manager may not approve themself.
  await expect(
    manager.getByRole('button', { name: vi['action.activate'], exact: true }),
  ).toHaveCount(0);
  await act(manager, vi['action.propose'], { [vi['dialog.note']]: 'Đúng giá 20 báo giá' });
  await expect(manager.getByText(/Đang chờ Owner hoặc Admin duyệt/)).toBeVisible();

  // The Owner sees the proposal and approves: the budget becomes 800.000đ.
  await page.goto('/workers');
  await page.getByRole('link', { name: /Minh · Báo giá/ }).click();
  await expect(page.getByText(/Nguyễn Thị Lan đề nghị cho lên chính thức/)).toBeVisible();
  await act(page, vi['action.activate']);
  await expect(badge(page)).toHaveText(vi['worker.status.active']);
  await expect(page.getByText('Ngân sách 800.000đ / tháng')).toBeVisible();
  await expect(page.getByText('Trần Minh Đức duyệt đề nghị của Nguyễn Thị Lan')).toBeVisible();

  // The Manager suspends, brings back, then offboards (typing the name).
  await manager.reload();
  await act(manager, vi['action.suspend']);
  await expect(badge(manager)).toHaveText(vi['worker.status.suspended']);
  await act(manager, vi['action.resume']);
  await expect(badge(manager)).toHaveText(vi['worker.status.active']);
  await manager.getByRole('button', { name: vi['action.offboard'], exact: true }).click();
  const offboard = manager.getByRole('alertdialog');
  const submit = offboard.getByRole('button', { name: vi['action.offboard'], exact: true });
  await offboard.getByLabel(new RegExp(vi['dialog.reason'])).fill('Đổi sang dùng Zalo OA');
  await offboard.getByLabel(/để xác nhận/).fill('Minh');
  await expect(submit).toBeDisabled();
  await offboard.getByLabel(/để xác nhận/).fill('Minh · Báo giá');
  await submit.click();
  await expect(offboard).toHaveCount(0);

  // Offboarded: read-only, no actions, listed under "Đã nghỉ việc".
  await expect(badge(manager)).toHaveText(vi['worker.status.offboarded']);
  await expect(manager.getByRole('button', { name: vi['profile.form.save'] })).toHaveCount(0);
  for (const action of ['startProbation', 'suspend', 'resume', 'offboard', 'propose'] as const) {
    await expect(
      manager.getByRole('button', { name: vi[`action.${action}`], exact: true }),
    ).toHaveCount(0);
  }
  await expect(manager.getByLabel(vi['profile.form.name'])).toBeDisabled();
  await manager.goto('/workers');
  await expect(manager.getByText(fill(vi['workers.gone'], { count: 1 }))).toBeVisible();
  await close();
});

for (const width of [320, 768, 1440]) {
  test(`org chart and profile at ${width}px for Owner and Manager: no overflow, filter in URL (screenshots)`, async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(90_000);
    const { manager, close } = await companyWithManager(page, browser);
    await page.setViewportSize({ width, height: 900 });
    await manager.setViewportSize({ width, height: 900 });

    // Owner adds a second department and hires into both.
    await page.goto('/departments');
    await page.getByRole('button', { name: vi['departments.add'] }).click();
    const add = page.getByRole('dialog', { name: vi['departments.dialog.addTitle'] });
    await add.getByLabel(vi['departments.dialog.name']).fill(vi['departments.suggest.accounting']);
    await add.getByRole('button', { name: vi['departments.dialog.submitAdd'] }).click();
    await expect(add).toHaveCount(0);
    for (const [template, name, department] of [
      ['template.quote-assistant.title', 'Minh · Báo giá', vi['departments.suggest.sales']],
      ['template.report-digest.title', 'Thu · Công nợ', vi['departments.suggest.accounting']],
    ] as const) {
      await page.goto('/workers');
      await page
        .getByRole('button', { name: vi['workers.hire'] })
        .or(page.getByRole('button', { name: new RegExp(vi[template]) }))
        .first()
        .click();
      const hire = page.getByRole('dialog', { name: vi['hire.title'] });
      await hire.getByText(vi[template], { exact: true }).click();
      await expect(hire.getByRole('radio', { name: new RegExp(vi[template]) })).toBeChecked();
      await hire.getByLabel(vi['hire.name']).fill(name);
      await hire.getByLabel(vi['hire.department']).selectOption({ label: department });
      await page.screenshot({
        path: testInfo.outputPath(`hire-${width}.png`),
        animations: 'disabled',
      });
      await hire.getByRole('button', { name: vi['hire.submit'] }).click();
      await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
      await act(page, vi['action.startProbation']);
    }
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: testInfo.outputPath(`profile-owner-${width}.png`),
      fullPage: true,
    });

    // Owner: every department, filter kept in the URL across a reload.
    await page.goto('/workers');
    await expect(page.getByRole('link', { name: /Thu · Công nợ/ })).toBeVisible();
    await page
      .getByRole('link', { name: /Thử việc/ })
      .first()
      .click();
    await expect(page).toHaveURL(/status=probation/);
    await page.reload();
    await expect(page.getByRole('link', { name: /Minh · Báo giá/ })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath(`org-owner-${width}.png`), fullPage: true });

    // Manager: own department, only a count for the other one.
    await manager.goto('/workers');
    await expect(manager.getByRole('link', { name: /Minh · Báo giá/ })).toBeVisible();
    await expect(manager.getByText('Thu · Công nợ')).toHaveCount(0);
    await expect(manager.getByRole('heading', { name: vi['workers.others.title'] })).toBeVisible();
    await expect(manager.getByText(`${vi['departments.suggest.accounting']} 1`)).toBeVisible();
    expect(await overflow(manager)).toBeLessThanOrEqual(0);
    await manager.screenshot({
      path: testInfo.outputPath(`org-manager-${width}.png`),
      fullPage: true,
    });

    // Keyboard: the first action is reachable and its dialog closes with Escape.
    await manager.getByRole('link', { name: /Minh · Báo giá/ }).click();
    const propose = manager.getByRole('button', { name: vi['action.propose'], exact: true });
    await propose.focus();
    await manager.keyboard.press('Enter');
    await expect(manager.getByRole('dialog')).toBeVisible();
    await manager.keyboard.press('Escape');
    await expect(manager.getByRole('dialog')).toHaveCount(0);
    expect(await overflow(manager)).toBeLessThanOrEqual(0);
    await manager.screenshot({
      path: testInfo.outputPath(`profile-manager-${width}.png`),
      fullPage: true,
    });
    await close();
  });
}
