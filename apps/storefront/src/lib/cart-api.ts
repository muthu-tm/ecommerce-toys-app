'use client';

import type { AddCartItemRequest, CartView } from '@romp/contracts';

/**
 * The storefront's client for the cart API.
 *
 * The cart is written through the API and never by the client, so this is the only way the
 * storefront changes a cart: it POSTs a mutation and gets back the whole `CartView` to render. Every
 * request sends credentials so the signed guest-cart cookie rides along — that cookie is how an
 * anonymous shopper's cart is found across requests, and the API is its only reader. A non-2xx
 * response becomes a thrown `CartApiError` carrying the server's message, so the buy box and the
 * cart page can show the store's own copy ("not enough stock", say).
 *
 * `NEXT_PUBLIC_API_BASE_URL` is the API origin — deployment configuration, the same value the admin
 * app uses. Coverage-excluded: it is fetch glue; the request shapes it sends are the contract types.
 */

const apiBase = (): string => (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/u, '');

/** A structured cart API failure, carrying the problem+json code for the UI to branch on. */
export class CartApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, detail: string) {
    super(detail);
    this.name = 'CartApiError';
    this.status = status;
    this.code = code;
  }
}

async function request(method: string, path: string, body?: unknown): Promise<CartView> {
  const response = await fetch(`${apiBase()}${path}`, {
    method,
    // Send and accept the signed cart cookie on every request.
    credentials: 'include',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { code?: string; detail?: string };
    throw new CartApiError(
      response.status,
      problem.code ?? 'INTERNAL',
      problem.detail ?? 'Something went wrong with your bag.',
    );
  }

  return response.json() as Promise<CartView>;
}

export const cartApi = {
  get: () => request('GET', '/v1/cart'),
  add: (body: AddCartItemRequest) => request('POST', '/v1/cart/items', body),
  remove: (variantId: string) => request('DELETE', `/v1/cart/items/${variantId}`),
  setGiftWrap: (giftWrap: boolean) => request('PATCH', '/v1/cart', { giftWrap }),
};
