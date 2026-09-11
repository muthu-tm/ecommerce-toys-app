/**
 * Admin-side helpers for the E2E flow.
 *
 * The admin app has no browser sign-in surface in v1.0 (operator sign-in is a later feature),
 * so the admin flow authenticates the way the platform's own tooling does against the
 * emulator: it signs in through the **Auth emulator's REST endpoint** to get a real ID token
 * that carries the seeded `owner` role claim, then calls the same admin API routes the future
 * UI will call. That exercises the real money-and-stock writes (verify payment, advance
 * fulfilment) with a real role-gated token — the meaningful end-to-end coverage available
 * today — while the spec still asserts the admin *read* UI reflects the result.
 */

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const API_BASE = (process.env.API_URL ?? 'http://localhost:8787').replace(/\/+$/u, '');

/**
 * Signs in against the Auth emulator and returns the operator's ID token.
 *
 * The emulator accepts any API key, and the token it mints includes the custom claims set by
 * `seed:admins` — so the `role: 'owner'` claim the API's admin guard reads is present.
 */
export async function operatorIdToken(email: string, password: string): Promise<string> {
  const url = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!res.ok) {
    throw new Error(
      `Auth emulator sign-in failed (HTTP ${String(res.status)}): ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { idToken?: string };
  if (body.idToken === undefined) throw new Error('Auth emulator returned no idToken.');
  return body.idToken;
}

interface AdminOrderSummary {
  readonly orderId: string;
  readonly humanId: string;
  readonly status: string;
  readonly amounts: { readonly totalMinor: number };
}

async function adminFetch<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} failed (HTTP ${String(res.status)}): ${await res.text()}`);
  }
  return (await res.json()) as T;
}

/** Finds an order in the admin list by its human id. */
export async function findOrderByHumanId(
  token: string,
  humanId: string,
): Promise<AdminOrderSummary> {
  const page = await adminFetch<{ orders: readonly AdminOrderSummary[] }>(
    token,
    'GET',
    `/v1/admin/orders?humanId=${encodeURIComponent(humanId)}`,
  );
  const match = page.orders.find((order) => order.humanId === humanId) ?? page.orders[0];
  if (match === undefined) throw new Error(`No admin order found for ${humanId}.`);
  return match;
}

/** Verifies the payment against the order total, moving it to `paid`. */
export async function verifyPayment(
  token: string,
  orderId: string,
  paidAmountMinor: number,
): Promise<void> {
  await adminFetch(token, 'POST', `/v1/admin/orders/${orderId}/verify-payment`, {
    paidAmountMinor,
  });
}

/** Advances fulfilment one step (e.g. to `packed`). */
export async function advanceFulfilment(
  token: string,
  orderId: string,
  status: string,
): Promise<void> {
  await adminFetch(token, 'POST', `/v1/admin/orders/${orderId}/fulfilment`, {
    status,
    carrier: null,
    trackingNo: null,
    holdReason: null,
  });
}
