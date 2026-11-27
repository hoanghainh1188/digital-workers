import { expect, type Page, test } from '@playwright/test';
import { vi } from '../src/i18n/vi.ts';

const PASSWORD = 'gom an phu bat trang';
const uniqueEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

async function fillSignup(page: Page, input: { email: string; password: string }) {
  await page.goto('/signup');
  await page.getByLabel(vi['signup.companyName']).fill('Gốm An Phú');
  await page.getByLabel(vi['signup.name']).fill('Nguyễn An');
  await page.getByLabel(vi['signup.email']).fill(input.email);
  await page.getByLabel(vi['signup.password'], { exact: true }).fill(input.password);
  await page.getByRole('checkbox', { name: vi['signup.terms'] }).check();
  await page.getByRole('button', { name: vi['signup.submit'] }).click();
}

test('sign up → app → sign out → sign in again', async ({ page }) => {
  const email = uniqueEmail();
  await fillSignup(page, { email, password: PASSWORD });

  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    `${vi['home.greeting']}, Nguyễn An`,
  );
  await expect(page.getByText('Gốm An Phú')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: vi['banner.resend'] })).toBeVisible();

  await page.getByRole('button', { name: vi['shell.signOut'] }).click();
  await expect(page).toHaveURL('/login');
  await page.goto('/');
  await expect(page).toHaveURL('/login');

  await page.getByLabel(vi['login.email']).fill(email);
  await page.getByLabel(vi['login.password'], { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: vi['login.submit'] }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Nguyễn An');
});

test('a weak password is reported on the password field', async ({ page }) => {
  await fillSignup(page, { email: uniqueEmail(), password: '1234567890' });
  const password = page.getByLabel(vi['signup.password'], { exact: true });
  await expect(password).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(vi['form.password_common'])).toBeVisible();
  await expect(page).toHaveURL('/signup');
});

test('a wrong password shows one generic message', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(vi['login.email']).fill(uniqueEmail());
  await page.getByLabel(vi['login.password'], { exact: true }).fill('not the password');
  await page.getByRole('button', { name: vi['login.submit'] }).click();
  await expect(page.getByRole('alert')).toHaveText(vi['login.error.invalid']);
});

test('the verification link from the email verifies the address and hides the banner', async ({
  page,
  request,
}) => {
  const email = uniqueEmail();
  await fillSignup(page, { email, password: PASSWORD });
  await expect(page).toHaveURL('/');
  const emails = await request.get(
    `http://127.0.0.1:4310/__e2e/emails?to=${encodeURIComponent(email)}`,
  );
  const [message] = (await emails.json()) as Array<{ text: string }>;
  const link = message?.text.match(/https?:\/\/\S+/)?.[0] ?? '';
  await page.goto(new URL(link).pathname + new URL(link).search);
  await expect(page.getByText(vi['verify.success'])).toBeVisible();
  await page.getByRole('link', { name: vi['verify.continue'] }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(vi['banner.resend'])).toHaveCount(0);
});

test('Google button is hidden when Google is not configured', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: vi['login.title'] })).toBeVisible();
  await expect(page.getByRole('button', { name: vi['signup.google'] })).toHaveCount(0);
});

for (const width of [320, 1440]) {
  test(`no horizontal overflow at ${width}px (signup, login, app)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: vi['login.title'] })).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await fillSignup(page, { email: uniqueEmail(), password: PASSWORD });
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
}

test('pages are Vietnamese and use the self-hosted font', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (req) => {
    if (!req.url().startsWith('http://localhost:4173')) external.push(req.url());
  });
  await page.goto('/signup');
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  await expect(page).toHaveTitle(vi['app.name']);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('16px "Be Vietnam Pro"', 'Đội ngũ'))).toBe(
    true,
  );
  expect(external).toEqual([]);
});

// Stands in for a first Google sign-in: an account that has no company yet (design D11).
test('a signed-in user without a company goes through "Tạo công ty"', async ({ page }) => {
  const res = await page.request.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:4173' },
    data: { name: 'Lê Chi', email: uniqueEmail(), password: PASSWORD },
  });
  expect(res.ok()).toBe(true);
  await page.goto('/');
  await expect(page).toHaveURL('/onboarding');
  await page.getByRole('button', { name: vi['onboarding.submit'] }).click();
  await expect(page.getByText(vi['form.required.companyName'])).toBeVisible();
  await page.getByLabel(vi['signup.companyName']).fill('Gốm Chi');
  await page.getByRole('button', { name: vi['onboarding.submit'] }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByText('Gốm Chi')).toBeVisible();
});
