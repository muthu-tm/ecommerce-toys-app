import { expect, test } from '@playwright/test';

import { TEST_ADDRESS, TEST_UTR, makeCustomer, writeOrderHandoff } from '../fixtures/data';
import { watchProductionFirebase } from '../fixtures/network';

/**
 * The customer happy path, end to end against the live emulator stack.
 *
 * register → sign in (automatic after register) → add a delivery address → browse to a
 * product → add to bag → checkout → place order → submit the UPI reference → see the order in
 * account history. Every step is a real browser action against the real API and the emulator,
 * exercising the client-SDK auth wiring, the cart cookie, order placement and payment-proof
 * submission — the surfaces that unit and component tests mock.
 *
 * The placed order's human id is written to a handoff file so the admin spec (a separate
 * Playwright project) can verify and fulfil the same order.
 */

const customer = makeCustomer();

test.describe.configure({ mode: 'serial' });

test('customer registers, orders, and submits payment', async ({ page }) => {
  const productionFirebase = watchProductionFirebase(page);

  // --- register (signs in on success) ---
  await page.goto('/account/register');
  await page.getByLabel(/your name/iu).fill(customer.displayName);
  await page.getByLabel(/email or mobile/iu).fill(customer.email);
  await page.getByLabel(/password/iu).fill(customer.password);
  await page.getByRole('button', { name: /create account/iu }).click();

  // Lands on the account dashboard once registration + sign-in complete.
  await page.waitForURL(/\/account(\/|$)/u, { timeout: 30_000 });
  expect(
    productionFirebase(),
    'customer Auth must talk to the emulator, not identitytoolkit.googleapis.com',
  ).toEqual([]);

  // --- add a delivery address (checkout requires one) ---
  await page.goto('/account/addresses');
  await page.getByLabel(/^label/iu).fill(TEST_ADDRESS.label);
  await page.getByLabel(/recipient name/iu).fill(TEST_ADDRESS.recipientName);
  await page.getByLabel(/address line 1/iu).fill(TEST_ADDRESS.line1);
  await page.getByLabel(/^city/iu).fill(TEST_ADDRESS.city);
  await page.getByLabel(/^state/iu).fill(TEST_ADDRESS.state);
  await page.getByLabel(/pin code/iu).fill(TEST_ADDRESS.pincode);
  await page.getByLabel(/contact number/iu).fill(TEST_ADDRESS.phone);
  await page.getByRole('button', { name: /save address/iu }).click();

  // The saved address appears in the list.
  await expect(page.getByText(TEST_ADDRESS.line1, { exact: false })).toBeVisible();

  // --- browse to a product and add to the bag ---
  await page.goto('/');
  const firstProduct = page.locator('a[href*="/p/"]').first();
  await expect(firstProduct).toBeVisible();
  await firstProduct.click();
  await page.waitForURL(/\/p\//u);

  await page.getByRole('button', { name: /add to bag/iu }).click();

  // Add-to-cart navigates to the bag.
  await page.waitForURL(/\/cart/u);
  await expect(page.getByRole('link', { name: /checkout|check out/iu }).first()).toBeVisible();

  // --- checkout and place the order ---
  await page.goto('/checkout');
  await expect(page.getByRole('heading', { name: /^checkout$/iu })).toBeVisible();
  // The quote loads and the total renders before the button enables.
  await expect(page.getByTestId('checkout-total')).toBeVisible({ timeout: 20_000 });

  const placeOrder = page.getByRole('button', { name: /place order/iu });
  await expect(placeOrder).toBeEnabled({ timeout: 20_000 });
  await placeOrder.click();

  // Lands on the order confirmation at /orders/<id>.
  await page.waitForURL(/\/orders\//u, { timeout: 30_000 });
  const heading = page.getByRole('heading', { name: /^order\s+/iu });
  await expect(heading).toBeVisible();
  const humanId = (await heading.textContent())?.replace(/^order\s+/iu, '').trim() ?? '';
  expect(humanId).not.toEqual('');
  writeOrderHandoff(humanId);

  // --- submit the UPI payment reference ---
  await expect(page.getByTestId('upi-qr')).toBeVisible();
  await page.getByLabel(/upi transaction reference/iu).fill(TEST_UTR);
  await page.getByRole('button', { name: /submit payment reference/iu }).click();

  // The status headline moves to "under review".
  await expect(page.getByText(/we are checking your payment/iu)).toBeVisible({ timeout: 20_000 });

  // --- confirm the order shows in account history ---
  await page.goto('/account/orders');
  await expect(page.getByText(humanId, { exact: false })).toBeVisible({ timeout: 20_000 });
});
