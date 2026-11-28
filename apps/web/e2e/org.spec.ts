import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { vi } from '../src/i18n/vi.ts';

/** Change 1b end to end (task 9.1): departments, invitations, lock, password reset. */

const PASSWORD = 'gom an phu bat trang';
const NEW_PASSWORD = 'binh minh tren song hong';
const EMAILS = 'http://127.0.0.1:4310/__e2e/emails';
const uniqueEmail = (label: string) =>
  `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

async function linkTo(request: APIRequestContext, to: string, pattern: RegExp): Promise<URL> {
  await expect
    .poll(async () => {
      const res = await request.get(`${EMAILS}?to=${encodeURIComponent(to)}`);
      const emails = (await res.json()) as Array<{ text: string }>;
      return emails.some((email) => pattern.test(email.text));
    })
    .toBe(true);
  const res = await request.get(`${EMAILS}?to=${encodeURIComponent(to)}`);
  const emails = (await res.json()) as Array<{ text: string }>;
  const text = [...emails].reverse().find((email) => pattern.test(email.text))?.text ?? '';
  return new URL(text.match(/https?:\/\/\S+/g)?.find((url) => pattern.test(url)) ?? '');
}

async function signUpOwner(page: Page, email: string) {
  await page.goto('/signup');
  await page.getByLabel(vi['signup.companyName']).fill('Gốm An Phú');
  await page.getByLabel(vi['signup.name']).fill('Trần Minh Đức');
  await page.getByLabel(vi['signup.email']).fill(email);
  await page.getByLabel(vi['signup.password'], { exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox', { name: vi['signup.terms'] }).check();
  await page.getByRole('button', { name: vi['signup.submit'] }).click();
  await expect(page).toHaveURL('/');
}

async function verifyOwner(page: Page, email: string) {
  const link = await linkTo(page.request, email, /verify-email/);
  await page.goto(link.pathname + link.search);
  await expect(page.getByText(vi['verify.success'])).toBeVisible();
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('Owner verifies → creates a department → invites → invitee joins → Owner locks them → they are signed out', async ({
  page,
  browser,
}) => {
  const ownerEmail = uniqueEmail('owner');
  const staffEmail = uniqueEmail('staff');
  await signUpOwner(page, ownerEmail);

  // Not verified yet: the invite button is disabled with a hint (0.2 #033).
  await page.getByRole('link', { name: vi['shell.nav.people'] }).click();
  await expect(page.getByRole('button', { name: vi['users.invite'] })).toBeDisabled();
  await expect(page.getByText(vi['users.inviteNeedsVerify'])).toBeVisible();
  await verifyOwner(page, ownerEmail);

  // Empty company: one click on a suggestion creates the department.
  await page.goto('/departments');
  await expect(page.getByRole('heading', { name: vi['departments.empty.title'] })).toBeVisible();
  await page.getByRole('button', { name: vi['departments.suggest.sales'] }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: vi['departments.suggest.sales'] }),
  ).toBeVisible();

  // Invite one Nhân viên into Kinh doanh.
  await page.getByRole('link', { name: vi['shell.nav.people'] }).click();
  await page.getByRole('button', { name: vi['users.invite'] }).click();
  const dialog = page.getByRole('dialog', { name: vi['invites.title'] });
  await dialog.getByLabel(vi['invites.emails']).fill(`${staffEmail}, thu@gomanphu`);
  await dialog.getByLabel(vi['invites.emails']).press('Enter');
  await expect(dialog.getByText(`"thu@gomanphu" ${vi['invites.emails.invalid']}`)).toBeVisible();
  await dialog.getByRole('button', { name: `${vi['invites.emails.remove']} thu@gomanphu` }).click();
  await dialog
    .getByLabel(vi['invites.department'])
    .selectOption({ label: vi['departments.suggest.sales'] });
  await dialog.getByRole('button', { name: 'Gửi 1 lời mời' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Đã gửi 1 lời mời.' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: staffEmail })).toContainText(
    vi['users.status.invited'],
  );

  // The invitee opens the link in another browser and joins with a password.
  const inviteLink = await linkTo(page.request, staffEmail, /\/invite#token=/);
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await staff.goto(inviteLink.pathname + inviteLink.hash);
  await expect(staff.getByText('Gốm An Phú')).toBeVisible();
  await expect(staff.getByLabel(vi['signup.email'])).toHaveValue(staffEmail);
  await expect(staff.getByLabel(vi['signup.email'])).toHaveAttribute('readonly', '');
  // The token left the address bar.
  expect(new URL(staff.url()).hash).toBe('');
  await staff.getByLabel(vi['signup.name']).fill('Phan Quang');
  await staff.getByLabel(vi['signup.password'], { exact: true }).fill(PASSWORD);
  await staff.getByRole('button', { name: vi['invite.submit'] }).click();
  await expect(staff).toHaveURL('/');
  await expect(staff.getByRole('heading', { level: 1 })).toContainText('Phan Quang');
  // A Nhân viên has no Người dùng link and no verification banner.
  await expect(staff.getByRole('link', { name: vi['shell.nav.people'] })).toHaveCount(0);
  await expect(staff.getByText(vi['banner.resend'])).toHaveCount(0);

  // The Owner locks them.
  await page.reload();
  await page.getByRole('button', { name: `${vi['users.actionsFor']} Phan Quang` }).click();
  await page.getByRole('menuitem', { name: vi['users.action.lock'] }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: vi['users.lock.submit'] })
    .click();
  await expect(page.getByRole('button', { name: vi['users.action.unlock'] })).toBeVisible();

  // Their session is gone: the next page load goes to sign-in, and sign-in says "locked".
  await staff.reload();
  await expect(staff).toHaveURL('/login');
  await staff.getByLabel(vi['login.email']).fill(staffEmail);
  await staff.getByLabel(vi['login.password'], { exact: true }).fill(PASSWORD);
  await staff.getByRole('button', { name: vi['login.submit'] }).click();
  await expect(staff.getByRole('alert')).toHaveText(vi['login.error.locked']);
  await staffContext.close();
});

test('forgot password → reset → sign in with the new password', async ({ page }) => {
  const email = uniqueEmail('reset');
  await signUpOwner(page, email);
  await page.getByRole('button', { name: vi['shell.signOut'] }).click();
  await expect(page).toHaveURL('/login');

  await page.getByRole('link', { name: vi['login.forgot'] }).click();
  await page.getByLabel(vi['login.email']).fill(email);
  await page.getByRole('button', { name: vi['forgot.submit'] }).click();
  await expect(page.getByRole('status')).toHaveText(vi['forgot.sent']);

  const link = await linkTo(page.request, email, /\/api\/auth\/reset-password\//);
  await page.goto(link.pathname + link.search);
  await expect(page).toHaveURL(/\/reset-password\?token=/);
  await page.getByLabel(vi['reset.password'], { exact: true }).fill('1234567890');
  await page.getByRole('button', { name: vi['reset.submit'] }).click();
  await expect(page.getByText(vi['form.password_common'])).toBeVisible();
  await page.getByLabel(vi['reset.password'], { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: vi['reset.submit'] }).click();
  await expect(page.getByRole('status')).toHaveText(vi['reset.done']);

  // The link worked once.
  await page.goto(link.pathname + link.search);
  await expect(page.getByRole('heading', { name: vi['reset.invalid.title'] })).toBeVisible();

  await page.goto('/login');
  await page.getByLabel(vi['login.email']).fill(email);
  await page.getByLabel(vi['login.password'], { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: vi['login.submit'] }).click();
  await expect(page).toHaveURL('/');
});

test('an unknown invitation token shows "không còn hiệu lực" without company details', async ({
  page,
}) => {
  await page.goto('/invite#token=not-a-real-token');
  await expect(page.getByRole('heading', { name: vi['invite.invalid.title'] })).toBeVisible();
  await expect(page.getByRole('link', { name: vi['invite.toLogin'] })).toBeVisible();
});

for (const width of [375, 1440]) {
  test(`departments and users at ${width}px: no horizontal overflow (screenshots)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const email = uniqueEmail(`shot${width}`);
    await signUpOwner(page, email);
    await verifyOwner(page, email);
    await page.goto('/departments');
    await page.getByRole('button', { name: vi['departments.suggest.sales'] }).click();
    await page.getByRole('button', { name: vi['departments.add'] }).click();
    const add = page.getByRole('dialog', { name: vi['departments.dialog.addTitle'] });
    await add.getByLabel(vi['departments.dialog.name']).fill(vi['departments.suggest.accounting']);
    await add.getByLabel(/Mô tả/).fill('Hoá đơn, công nợ, báo cáo thuế');
    await page.screenshot({
      path: testInfo.outputPath(`departments-dialog-${width}.png`),
      animations: 'disabled',
    });
    await add.getByRole('button', { name: vi['departments.dialog.submitAdd'] }).click();
    await expect(add).toHaveCount(0);
    await expect(
      page.getByRole('heading', { level: 2, name: vi['departments.suggest.accounting'] }),
    ).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: testInfo.outputPath(`departments-${width}.png`),
      fullPage: true,
    });

    await page.goto('/users');
    await page.getByRole('button', { name: vi['users.invite'] }).click();
    const dialog = page.getByRole('dialog', { name: vi['invites.title'] });
    await dialog.getByLabel(vi['invites.emails']).fill(uniqueEmail('lan'));
    await dialog
      .getByLabel(vi['invites.department'])
      .selectOption({ label: vi['departments.suggest.sales'] });
    await page.screenshot({
      path: testInfo.outputPath(`invite-dialog-${width}.png`),
      animations: 'disabled',
    });
    await dialog.getByRole('button', { name: 'Gửi 1 lời mời' }).click();
    await expect(page.getByText(vi['users.notAccepted'])).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: testInfo.outputPath(`users-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });

    // Filters live in the URL.
    await page.getByRole('combobox', { name: vi['users.filter.role'] }).selectOption('owner');
    await expect(page).toHaveURL(/role=owner/);
    await page.getByPlaceholder(vi['users.search']).fill('không có ai tên này');
    await expect(page.getByRole('button', { name: vi['users.empty.clear'] })).toBeVisible();
    await page.getByRole('button', { name: vi['users.empty.clear'] }).click();
    await expect(page).toHaveURL('/users');
  });
}
