import { expect, test } from '@playwright/test';

import {
  advanceFulfilment,
  findOrderByHumanId,
  operatorIdToken,
  verifyPayment,
} from '../fixtures/admin-api';
import { SEEDED_ADMIN, readOrderHandoff } from '../fixtures/data';
import { watchProductionFirebase } from '../fixtures/network';

/**
 * The admin happy path: settle the order the customer flow placed.
 *
 * Sign in as the seeded owner → find the pending order → verify its payment → advance
 * fulfilment → confirm the backoffice order detail reflects paid + packed.
 *
 * The write actions (verify payment, advance fulfilment) go through the real admin API with a
 * real role-claimed token from the Auth emulator — there is no UI payment-verification control,
 * so these are the same routes an operator's controls call. The browser then signs in through
 * the real backoffice login form (the app is now gated behind an operator sign-in), and the
 * assertion is against the real admin *read* UI on :3001, so the end-to-end effect (an order
 * moving to paid and packed) is verified where an operator would see it.
 */

test.describe.configure({ mode: 'serial' });

test('admin verifies payment and fulfils the order', async ({ page }) => {
  const handoff = readOrderHandoff();
  expect(handoff, 'the customer spec must run first and hand off an order').not.toBeNull();
  const humanId = handoff!.humanId;

  // --- authenticate as the seeded owner (real role-claimed token) ---
  const token = await operatorIdToken(SEEDED_ADMIN.email, SEEDED_ADMIN.password);

  // --- find the order and settle it through the real admin API ---
  const order = await findOrderByHumanId(token, humanId);
  expect(order.status).toBe('pending_verification');

  await verifyPayment(token, order.orderId, order.amounts.totalMinor);
  await advanceFulfilment(token, order.orderId, 'packed');

  // --- sign in through the backoffice UI so the access gate lets us in ---
  // The backoffice now guards every page behind an operator sign-in (the gate checks the
  // role claim via GET /v1/admin/me). Signing in through the real login form is what a real
  // operator does, and it exercises the gate end to end rather than bypassing it.
  const productionFirebase = watchProductionFirebase(page);
  await page.goto('/');
  await page.getByLabel(/email or mobile/iu).fill(SEEDED_ADMIN.email);
  await page.getByLabel(/password/iu).fill(SEEDED_ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 15_000 });
  expect(
    productionFirebase(),
    'admin Auth must talk to the emulator, not identitytoolkit.googleapis.com',
  ).toEqual([]);

  // --- confirm the backoffice read UI reflects the settled state ---
  await page.goto(`/orders/${order.orderId}`);
  await expect(page.getByRole('heading', { name: humanId })).toBeVisible({ timeout: 15_000 });
  // The two status badges sit next to the heading: payment "Paid" and fulfilment "Packed".
  // `.first()` because "Packed" also appears later in the audit timeline.
  await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Packed', { exact: true }).first()).toBeVisible();
});
