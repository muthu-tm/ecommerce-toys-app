import { expect, test } from '@playwright/test';

/**
 * The harness smoke test: proves the suite runs against the live stack.
 *
 * If this passes, `global-setup` found the stack up, Playwright reached the storefront, and
 * SSR rendered the seeded catalogue. It is the cheapest possible signal that the whole E2E
 * plumbing — orchestrator, emulator wiring, seed, config — is working before the richer
 * customer and admin flows run.
 */
test('storefront home renders the seeded catalogue', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/.+/u);
  await expect(page.locator('main')).toBeVisible();

  const shopNav = page.getByRole('navigation', { name: 'Shop' });
  await expect(shopNav).toBeVisible();
  await expect(shopNav.getByRole('link', { name: 'Shop by age' })).toBeVisible();
  await expect(shopNav.getByRole('link', { name: 'All toys' })).toBeVisible();
  await expect(shopNav.getByRole('link', { name: 'Wooden toys' })).toHaveCount(0);

  const productLinks = page.locator('a[href*="/p/"]');
  await expect(productLinks.first()).toBeVisible();
});
