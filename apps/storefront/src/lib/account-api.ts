import type {
  AddressCreateRequest,
  AddressCreateResponse,
  AddressUpdateRequest,
  MeResponse,
  MeUpdateRequest,
  OrderListResponse,
  OwnReviewListResponse,
  PasswordChangeRequest,
  RegisterRequest,
  RegisterResponse,
  ReviewSubmitRequest,
  ReviewSubmitResponse,
} from '@romp/contracts';

import { idToken } from './firebase-client';

/**
 * The storefront's client for the account API.
 *
 * The same bearer-token pattern as `order-api.ts`: every write attaches a fresh Firebase ID token
 * (the account routes verify one on each request, since the Admin SDK bypasses rules and the token
 * is the only identity), and a non-2xx becomes a thrown `AccountApiError` carrying the problem+json
 * `code` so a form can branch on it — a bad PIN code, a taken identifier, a default that cannot be
 * deleted each get the server's own message.
 *
 * Registration is the one call with no token: it creates the account the customer then signs in to.
 *
 * `NEXT_PUBLIC_API_BASE_URL` is the API origin — deployment configuration. Coverage-excluded fetch
 * glue; the request and response shapes are the contract types.
 */

const apiBase = (): string => (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/u, '');

/** A structured account API failure, carrying the problem+json code for the UI to branch on. */
export class AccountApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, detail: string) {
    super(detail);
    this.name = 'AccountApiError';
    this.status = status;
    this.code = code;
  }
}

async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = await idToken();
  if (token === null) {
    throw new AccountApiError(401, 'UNAUTHENTICATED', 'Please sign in to manage your account.');
  }
  return { authorization: `Bearer ${token}`, ...extra };
}

async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { code?: string; detail?: string };
    throw new AccountApiError(
      response.status,
      problem.code ?? 'INTERNAL',
      problem.detail ?? 'Something went wrong.',
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/** Authenticated JSON request with a bearer token. */
async function authed<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = await authHeaders(body === undefined ? {} : { 'content-type': 'application/json' });
  const response = await fetch(`${apiBase()}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return parse<T>(response);
}

/** An authenticated request whose success carries no body (204). Kept separate to avoid a `void` type arg. */
async function authedNoContent(method: string, path: string, body?: unknown): Promise<void> {
  await authed<unknown>(method, path, body);
}

export const accountApi = {
  /** Registers a new account. No token — this is how a signed-out visitor becomes a customer. */
  register: async (body: RegisterRequest): Promise<RegisterResponse> => {
    const response = await fetch(`${apiBase()}/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return parse<RegisterResponse>(response);
  },

  me: () => authed<MeResponse>('GET', '/v1/me'),
  updateProfile: (body: MeUpdateRequest) => authed<MeResponse>('PATCH', '/v1/me', body),
  changePassword: (body: PasswordChangeRequest) =>
    authedNoContent('POST', '/v1/auth/password-change', body),

  listOrders: () => authed<OrderListResponse>('GET', '/v1/orders'),

  createAddress: (body: AddressCreateRequest) =>
    authed<AddressCreateResponse>('POST', '/v1/addresses', body),
  updateAddress: (id: string, body: AddressUpdateRequest) =>
    authedNoContent('PATCH', `/v1/addresses/${id}`, body),
  deleteAddress: (id: string) => authedNoContent('DELETE', `/v1/addresses/${id}`),

  addToWishlist: (productId: string) => authedNoContent('PUT', `/v1/wishlist/${productId}`),
  removeFromWishlist: (productId: string) => authedNoContent('DELETE', `/v1/wishlist/${productId}`),

  submitReview: (body: ReviewSubmitRequest) =>
    authed<ReviewSubmitResponse>('POST', '/v1/reviews', body),
  listReviews: () => authed<OwnReviewListResponse>('GET', '/v1/account/reviews'),
};
