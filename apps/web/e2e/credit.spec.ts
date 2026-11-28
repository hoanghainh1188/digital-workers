import { createHmac } from 'node:crypto';
import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { vi } from '../src/i18n/vi.ts';

/**
 * Change add-llm-gateway-and-credit, web (tasks 9.1–10.3): Credit page, "hết credit"
 * banner, TOTP for the platform admin and the platform admin pages. Serial: one platform
 * admin account exists per e2e run (PLATFORM_ADMIN_EMAILS in global-setup.ts).
 */

const PASSWORD = 'gom an phu bat trang';
const PLATFORM_ADMIN = 'platform-admin@dw.test';
const EMAILS = 'http://127.0.0.1:4310/__e2e/emails';
const uniqueEmail = (label: string) =>
  `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits), what an authenticator app shows. */
function totp(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  }
  const key = Buffer.from(
    Array.from({ length: Math.floor(bits.length / 8) }, (_, i) =>
      Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2),
    ),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = (hmac.at(-1) ?? 0) & 0x0f;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

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

async function signUp(page: Page, company: string, email: string, name = 'Trần Minh Đức') {
  await page.goto('/signup');
  await page.getByLabel(vi['signup.companyName']).fill(company);
  await page.getByLabel(vi['signup.name']).fill(name);
  await page.getByLabel(vi['signup.email']).fill(email);
  await page.getByLabel(vi['signup.password'], { exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox', { name: vi['signup.terms'] }).check();
  await page.getByRole('button', { name: vi['signup.submit'] }).click();
}

async function verify(page: Page, email: string) {
  const link = await linkTo(page.request, email, /verify-email/);
  await page.goto(link.pathname + link.search);
  await expect(page.getByText(vi['verify.success'])).toBeVisible();
}

/** Invites `email` with `role` and accepts in a fresh context; returns that page. */
async function invite(
  owner: Page,
  browser: Browser,
  email: string,
  role: 'admin' | 'manager',
  name: string,
) {
  await owner.goto('/users');
  await owner.getByRole('button', { name: vi['users.invite'] }).click();
  const dialog = owner.getByRole('dialog', { name: vi['invites.title'] });
  await dialog.getByLabel(vi['invites.emails']).fill(email);
  await dialog.getByLabel(vi['invites.emails']).press('Enter');
  await dialog.getByRole('radio', { name: new RegExp(`^${vi[`role.${role}`]}`) }).check();
  if (role === 'manager') {
    await dialog
      .getByLabel(vi['invites.department'])
      .selectOption({ label: vi['departments.suggest.sales'] });
  }
  await dialog.getByRole('button', { name: 'Gửi 1 lời mời' }).click();
  await expect(owner.getByRole('status').filter({ hasText: 'Đã gửi 1 lời mời.' })).toBeVisible();
  const link = await linkTo(owner.request, email, /\/invite#token=/);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link.pathname + link.hash);
  await page.getByLabel(vi['signup.name']).fill(name);
  await page.getByLabel(vi['signup.password'], { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: vi['invite.submit'] }).click();
  await expect(page).toHaveURL('/');
  return { page, context };
}

/** Platform admin: open the adjust dialog for `company` and submit. */
async function adjust(
  admin: Page,
  company: string,
  direction: 'credit' | 'debit',
  amount: number,
  note: string,
) {
  await admin.goto(`/platform/companies?q=${encodeURIComponent(company)}`);
  const row = admin.getByRole('row').filter({ hasText: company });
  await row.getByRole('button', { name: vi['platform.companies.adjust'] }).click();
  const dialog = admin.getByRole('dialog', {
    name: fill(vi['platform.adjust.title'], { company }),
  });
  await dialog
    .getByRole('radio', {
      name: direction === 'credit' ? vi['platform.adjust.credit'] : vi['platform.adjust.debit'],
    })
    .check();
  await dialog.getByLabel(vi['platform.adjust.amount']).fill(String(amount));
  await dialog.getByLabel(vi['platform.adjust.reason']).selectOption('bank_transfer');
  await dialog.getByLabel(vi['platform.adjust.note']).fill(note);
  const total = new Intl.NumberFormat('vi-VN').format(amount);
  await dialog
    .getByRole('button', {
      name: fill(
        vi[
          direction === 'credit' ? 'platform.adjust.submit.credit' : 'platform.adjust.submit.debit'
        ],
        { amount: `${total}đ` },
      ),
    })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(admin.getByRole('status').filter({ hasText: company })).toBeVisible();
}

test.describe
  .serial('credit and platform admin', () => {
    let adminContext: BrowserContext;
    let admin: Page;
    let secret = '';
    const company = `Gốm An Phú ${Date.now()}`;
    let owner: Page;

    test.beforeAll(async ({ browser }) => {
      adminContext = await browser.newContext();
      admin = await adminContext.newPage();
    });

    test.afterAll(async () => {
      await adminContext?.close();
    });

    test('10.1 platform admin signs up, verifies, turns TOTP on, and needs the code at each sign-in', async () => {
      test.setTimeout(60_000);
      await signUp(admin, 'Không tạo công ty', PLATFORM_ADMIN, 'Harry');
      await expect(admin).toHaveURL('/platform/setup-2fa');
      await expect(admin.getByText(/Xác minh email trước/)).toBeVisible();

      await verify(admin, PLATFORM_ADMIN);
      await admin.goto('/platform/setup-2fa');
      await admin.getByLabel(vi['setup2fa.password']).fill(PASSWORD);
      await admin.getByRole('button', { name: vi['setup2fa.start'] }).click();
      secret = (await admin.getByTestId('totp-secret').textContent()) ?? '';
      expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
      await expect(admin.getByRole('link', { name: vi['setup2fa.openApp'] })).toHaveAttribute(
        'href',
        /^otpauth:\/\/totp\//,
      );
      await expect(admin.locator('img, canvas, svg[data-qr]')).toHaveCount(0); // no QR code (#099)
      await admin.getByLabel(vi['twoFactor.code']).fill(totp(secret));
      await admin.getByRole('button', { name: vi['setup2fa.finish'] }).click();
      await expect(admin).toHaveURL('/platform/companies');
      await expect(
        admin.getByRole('heading', { level: 1, name: vi['platform.companies.title'] }),
      ).toBeVisible();

      // Sign out, sign in again: the password alone is not enough.
      await admin.getByRole('button', { name: vi['shell.signOut'] }).click();
      await expect(admin).toHaveURL('/login');
      await admin.getByLabel(vi['login.email']).fill(PLATFORM_ADMIN);
      await admin.getByLabel(vi['login.password'], { exact: true }).fill(PASSWORD);
      await admin.getByRole('button', { name: vi['login.submit'] }).click();
      await expect(admin).toHaveURL('/two-factor');
      await admin.getByLabel(vi['twoFactor.code']).fill('000000');
      await admin.getByRole('button', { name: vi['twoFactor.submit'] }).click();
      await expect(admin.getByRole('alert')).toHaveText(vi['twoFactor.error.invalid']);
      await admin.getByLabel(vi['twoFactor.code']).fill(totp(secret));
      await admin.getByRole('button', { name: vi['twoFactor.submit'] }).click();
      await expect(admin).toHaveURL('/platform/companies');
    });

    test('9.1 / 9.2 Owner credit page, exhausted banner on every page, cleared by a platform credit', async ({
      browser,
    }, testInfo) => {
      test.setTimeout(120_000);
      const context = await browser.newContext();
      owner = await context.newPage();
      const ownerEmail = uniqueEmail('owner');
      await signUp(owner, company, ownerEmail);
      await expect(owner).toHaveURL('/');
      await verify(owner, ownerEmail);

      // Trial credit after verification (#073).
      await owner.goto('/credit');
      await expect(
        owner.getByRole('heading', { level: 1, name: vi['credit.title'] }),
      ).toBeVisible();
      const card = owner.getByTestId('balance-card');
      await expect(card).toContainText('200.000');
      await expect(
        card.getByRole('button', { name: new RegExp(vi['credit.topup']) }),
      ).toBeDisabled();
      await expect(
        owner.getByRole('cell', { name: new RegExp(vi['credit.kind.trial']) }),
      ).toBeVisible();

      // The Owner never reaches the admin pages: same page as a missing path.
      await owner.goto('/platform/companies');
      await expect(owner.getByRole('heading', { name: vi['notFound.title'] })).toBeVisible();

      // Exhausted: the platform admin debits the whole balance.
      await adjust(admin, company, 'debit', 200_000, 'Thu hồi để thử');
      await owner.goto('/credit');
      await expect(
        owner.getByRole('alert').filter({ hasText: vi['creditBanner.title'] }),
      ).toBeVisible();
      await expect(card).toHaveAttribute('data-state', 'exhausted');
      await owner.goto('/departments');
      await expect(
        owner.getByRole('alert').filter({ hasText: vi['creditBanner.title'] }),
      ).toBeVisible();
      await shoot(owner, testInfo, 'exhausted');

      // Credited by the platform admin: the banner disappears, the line shows reason + note.
      await adjust(admin, company, 'credit', 1_000_000, 'CK Vietcombank 28/11');
      await owner.goto('/credit');
      await expect(
        owner.getByRole('alert').filter({ hasText: vi['creditBanner.title'] }),
      ).toHaveCount(0);
      await expect(card).toHaveAttribute('data-state', 'normal');
      await expect(owner.getByText('Đã nhận chuyển khoản · CK Vietcombank 28/11')).toBeVisible();
      await shoot(owner, testInfo, 'normal');

      // Low: below 20% of the last credit (1.000.000đ → 200.000đ).
      await adjust(admin, company, 'debit', 850_000, 'Thử dưới ngưỡng');
      await owner.goto('/credit');
      await expect(card).toHaveAttribute('data-state', 'low');
      await expect(owner.getByText(/hiện là 200\.000đ/)).toBeVisible();
      await shoot(owner, testInfo, 'low');
    });

    test('9.1 Admin sees the page without "Nạp credit"; Trưởng phòng has no menu item and is sent home', async ({
      browser,
    }) => {
      test.setTimeout(90_000);
      await owner.goto('/departments');
      await owner.getByRole('button', { name: vi['departments.suggest.sales'] }).click();
      await expect(
        owner.getByRole('heading', { level: 2, name: vi['departments.suggest.sales'] }),
      ).toBeVisible();

      const adminMember = await invite(owner, browser, uniqueEmail('anh'), 'admin', 'Lê Quốc Anh');
      await adminMember.page.getByRole('link', { name: vi['shell.nav.credit'] }).click();
      await expect(adminMember.page).toHaveURL('/credit');
      await expect(adminMember.page.getByTestId('balance-card')).toBeVisible();
      await expect(
        adminMember.page.getByRole('button', { name: new RegExp(vi['credit.topup']) }),
      ).toHaveCount(0);
      await expect(adminMember.page.getByText(vi['credit.help.adminLow'])).toBeVisible();
      await adminMember.context.close();

      const manager = await invite(owner, browser, uniqueEmail('lan'), 'manager', 'Nguyễn Thị Lan');
      await expect(manager.page.getByRole('link', { name: vi['shell.nav.credit'] })).toHaveCount(0);
      await manager.page.goto('/credit');
      await expect(manager.page).toHaveURL('/');
      await manager.context.close();
    });

    test('10.2 / 10.3 admin pages: add a price, key dialog, screenshots without overflow', async ({
      page: _unused,
    }, testInfo) => {
      test.setTimeout(90_000);
      await admin.goto('/platform/pricing');
      await expect(admin.getByText('25.400đ')).toBeVisible();
      await expect(admin.getByText('× 1,30')).toBeVisible();
      await admin.getByRole('button', { name: vi['platform.pricing.add'] }).click();
      const price = admin.getByRole('dialog', { name: vi['platform.price.title'] });
      await price.getByLabel(vi['platform.price.model']).fill('claude-sonnet-5-5');
      await price.getByLabel(vi['platform.price.input']).fill('3,00');
      await price.getByLabel(vi['platform.price.output']).fill('15,00');
      await price.getByLabel(vi['platform.price.cacheRead']).fill('0,30');
      await price.getByLabel(vi['platform.price.cacheWrite']).fill('3,75');
      await price.getByRole('button', { name: vi['platform.price.submit'] }).click();
      await expect(price).toHaveCount(0);
      const row = admin.getByRole('row').filter({ hasText: 'claude-sonnet-5-5' });
      await expect(row).toContainText('$3,00');
      await expect(row).toContainText('$15,00');
      await expect(row).toContainText('$3,75');

      await admin.goto('/platform/keys');
      await expect(admin.getByRole('heading', { name: /Anthropic/ })).toContainText(
        vi['platform.keys.missing'],
      );

      for (const width of [1024, 1440]) {
        await admin.setViewportSize({ width, height: 900 });
        for (const path of ['companies', 'pricing', 'keys']) {
          await admin.goto(`/platform/${path}`);
          await expect(admin.getByRole('heading', { level: 1 })).toBeVisible();
          expect(await overflow(admin)).toBeLessThanOrEqual(0);
          await admin.screenshot({
            path: testInfo.outputPath(`platform-${path}-${width}.png`),
            fullPage: true,
          });
        }
        await admin.goto(`/platform/companies?q=${encodeURIComponent(company)}`);
        await admin
          .getByRole('row')
          .filter({ hasText: company })
          .getByRole('button', { name: vi['platform.companies.adjust'] })
          .click();
        await expect(admin.getByRole('dialog')).toBeVisible();
        expect(await overflow(admin)).toBeLessThanOrEqual(0);
        await admin.screenshot({
          path: testInfo.outputPath(`platform-adjust-${width}.png`),
          animations: 'disabled',
        });
        await admin.getByRole('button', { name: vi['platform.cancel'] }).click();

        await admin.goto('/platform/keys');
        await admin.getByRole('button', { name: vi['platform.keys.add'] }).first().click();
        await expect(admin.getByRole('dialog')).toBeVisible();
        await admin.screenshot({
          path: testInfo.outputPath(`platform-key-${width}.png`),
          animations: 'disabled',
        });
        await admin.getByRole('button', { name: vi['platform.cancel'] }).click();
      }
    });
  });

/** Credit page at 320 / 768 / 1024 / 1440: screenshot and no horizontal overflow (task 9.3). */
async function shoot(
  page: Page,
  testInfo: { outputPath: (name: string) => string },
  state: string,
) {
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/credit');
    await expect(page.getByTestId('balance-card')).toBeVisible();
    expect(await overflow(page), `overflow at ${width}px (${state})`).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: testInfo.outputPath(`credit-${state}-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}
