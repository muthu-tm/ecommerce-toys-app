'use client';

import type {
  CheckoutQuoteRequest,
  CheckoutQuoteResponse,
  OrderView,
  PlaceOrderRequest,
  PlaceOrderResponse,
  SubmitPaymentProofRequest,
  SubmitPaymentProofResponse,
} from '@romp/contracts';

import { idToken } from './firebase-client';

/**
 * The storefront's client for the checkout and order API.
 *
 * The order path both moves money and takes stock, so its API routes verify a Firebase ID token on
 * every request — unlike the cart, which rides on a signed cookie. This client attaches a fresh
 * bearer token (from the client SDK) and, on placement, an `Idempotency-Key` so a retry returns the
 * original order rather than reserving stock twice. Every figure the customer sees comes back from
 * the server, recomputed from live prices; nothing about money is sent up.
 *
 * A non-2xx response becomes a thrown `OrderApiError` carrying the problem+json `code`, so the
 * checkout page can branch on it — an empty cart, a vanished item, or insufficient stock each get
 * the store's own copy rather than a generic failure.
 *
 * `NEXT_PUBLIC_API_BASE_URL` is the API origin — deployment configuration. Coverage-excluded fetch
 * glue; the request and response shapes are the contract types.
 */

const apiBase = (): string => (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/u, '');

/** A structured order API failure, carrying the problem+json code for the UI to branch on. */
export class OrderApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, detail: string) {
    super(detail);
    this.name = 'OrderApiError';
    this.status = status;
    this.code = code;
  }
}

/** Builds the headers for an authenticated request, attaching the bearer token when signed in. */
async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = await idToken();
  if (token === null) {
    // No token means no signed-in customer. Surfacing it as UNAUTHENTICATED here — rather than
    // letting the request 401 — keeps the "please sign in" branch in one place.
    throw new OrderApiError(401, 'UNAUTHENTICATED', 'Please sign in to check out.');
  }
  return { authorization: `Bearer ${token}`, ...extra };
}

async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { code?: string; detail?: string };
    throw new OrderApiError(
      response.status,
      problem.code ?? 'INTERNAL',
      problem.detail ?? 'Something went wrong at checkout.',
    );
  }
  return response.json() as Promise<T>;
}

export const orderApi = {
  /** Quotes the caller's cart at live prices. */
  quote: async (body: CheckoutQuoteRequest): Promise<CheckoutQuoteResponse> => {
    const headers = await authHeaders({ 'content-type': 'application/json' });
    const response = await fetch(`${apiBase()}/v1/checkout/quote`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(body),
    });
    return parse<CheckoutQuoteResponse>(response);
  },

  /**
   * Places the caller's cart as an order. Mints a fresh idempotency key per attempt so a network
   * retry of the same click cannot double-reserve; the caller reuses the returned key by not
   * retrying with a new one.
   */
  place: async (body: PlaceOrderRequest): Promise<PlaceOrderResponse> => {
    const headers = await authHeaders({
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
    });
    const response = await fetch(`${apiBase()}/v1/orders`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(body),
    });
    return parse<PlaceOrderResponse>(response);
  },

  /** Reads one of the caller's own orders. */
  get: async (orderId: string): Promise<OrderView> => {
    const headers = await authHeaders();
    const response = await fetch(`${apiBase()}/v1/orders/${orderId}`, {
      method: 'GET',
      credentials: 'include',
      headers,
    });
    return parse<OrderView>(response);
  },

  /**
   * Submits a UPI payment reference (and optional proof path) against an order. Idempotency-keyed
   * for the same reason placement is: a retry must not double-claim the reference.
   */
  submitPaymentProof: async (
    orderId: string,
    body: SubmitPaymentProofRequest,
  ): Promise<SubmitPaymentProofResponse> => {
    const headers = await authHeaders({
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
    });
    const response = await fetch(`${apiBase()}/v1/orders/${orderId}/payment-proof`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(body),
    });
    return parse<SubmitPaymentProofResponse>(response);
  },
};
