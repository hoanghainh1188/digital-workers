import { expect, test } from '@playwright/test';
import { vi } from '../src/i18n/vi.ts';

test('home page shows the Vietnamese title from the i18n file', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Digital Workers');
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(vi['home.title']);
});

test('home page has no horizontal overflow on a 320px screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
