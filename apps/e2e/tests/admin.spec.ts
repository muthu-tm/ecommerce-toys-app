import { expect, test } from '@playwright/test';

import {
  advanceFulfilment,
  findOrderByHumanId,
  operatorIdToken,
  verifyPayment,
} from '../fixtures/admin-api';
import { SEEDED_ADMIN, readOrderHandoff } from '../fixtures/data';

/**
 * The admin happy path: settle the order the customer flow placed.
 *
 * Sign in as the seeded owner → find the pending order → verify its payment → advance
 * fulfilment → confirm the backoffice order detail reflects paid + packed.
 *
 * The admin app ships no browser sign-in surface in v1.0 (operator sign-in is a later
 * feature) and no payment-verification control, so the write actions go through the real
 * admin API with a real role-claimed token obtained from the Auth emulator — the same routes
 * the future UI will call. The assertion is against the real admin *read* UI on :3001, so the
 * end-to-end effect (an order moving to paid and packed) is verified where an operator would
 * see it.
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

  // --- confirm the backoffice read UI reflects the settled state ---
  await page.goto(`/orders/${order.orderId}`);
  await expect(page.getByRole('heading', { name: humanId })).toBeVisible();
  // The two status badges sit next to the heading: payment "Paid" and fulfilment "Packed".
  // `.first()` because "Packed" also appears later in the audit timeline.
  await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Packed', { exact: true }).first()).toBeVisible();
});
