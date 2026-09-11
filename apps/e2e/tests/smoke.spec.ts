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

  // The page has a title and a main landmark — it is a real render, not an error page.
  await expect(page).toHaveTitle(/.+/u);
  await expect(page.locator('main')).toBeVisible();

  // At least one product card links into the catalogue, which only appears when SSR read the
  // seeded data. A bare shell with no products would fail here — the "up but empty" case.
  const productLinks = page.locator('a[href*="/p/"]');
  await expect(productLinks.first()).toBeVisible();
});
