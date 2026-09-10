import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * The signed anonymous-cart cookie.
 *
 * A guest cart is reached by an opaque cart ID the browser holds in a cookie. The ID alone would
 * be a forgeable pointer — a client could put someone else's guest cart ID in the cookie and reach
 * it — so the cookie carries the ID **and** an HMAC of it under a server secret. On read the
 * signature is verified in constant time before the ID is trusted; a tampered or unsigned cookie is
 * treated as no cookie, and the request starts a fresh cart. This is the whole reason anonymous
 * carts can be server-only despite being client-reachable: the API is the only party that can mint
 * or validate the pointer.
 *
 * The cookie is `HttpOnly` (the storefront never needs to read it in JS — the API does), `Secure`,
 * and `SameSite=Lax` so it rides along on top-level navigations to the cart without being a CSRF
 * vector on cross-site POSTs.
 */

/** The cookie name. Brand-neutral by design, so a second store ships the same technical cookie. */
export const CART_COOKIE_NAME = '__cart_id';

/** How long a guest cart cookie lives, in seconds — matched to the cart document's TTL (30 days). */
const CART_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** A fresh opaque cart ID for a new guest cart. */
export function newCartId(): string {
  return randomUUID();
}

/** The HMAC-SHA256 of a cart ID under the secret, hex-encoded. */
function signature(cartId: string, secret: string): string {
  return createHmac('sha256', secret).update(cartId).digest('hex');
}

/** The signed cookie value: `<cartId>.<hmac>`. */
export function signCartId(cartId: string, secret: string): string {
  return `${cartId}.${signature(cartId, secret)}`;
}

/**
 * Verifies a signed cookie value, returning the cart ID or null.
 *
 * Null when the value is malformed, or the signature does not match — either way the caller treats
 * it as no cookie and starts a fresh cart, so a bad cookie is never an error the client sees. The
 * comparison is constant-time to avoid leaking how much of a forged signature was correct.
 */
export function verifyCartCookie(value: string | undefined, secret: string): string | null {
  if (value === undefined) return null;
  const lastDot = value.lastIndexOf('.');
  if (lastDot <= 0) return null;

  const cartId = value.slice(0, lastDot);
  const provided = value.slice(lastDot + 1);
  const expected = signature(cartId, secret);

  // Constant-time compare; length-mismatched buffers cannot be compared, so guard first.
  const providedBuf = Buffer.from(provided, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (providedBuf.length !== expectedBuf.length || providedBuf.length === 0) return null;
  if (!timingSafeEqual(providedBuf, expectedBuf)) return null;

  return cartId;
}

/** Reads the raw cart cookie value from a Cookie header, or undefined. */
export function readCartCookie(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === CART_COOKIE_NAME) return rest.join('=');
  }
  return undefined;
}

/** The `Set-Cookie` header value that plants a signed cart cookie. */
export function cartCookieHeader(cartId: string, secret: string): string {
  const value = signCartId(cartId, secret);
  return [
    `${CART_COOKIE_NAME}=${value}`,
    'Path=/',
    `Max-Age=${String(CART_COOKIE_MAX_AGE_SECONDS)}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ');
}

/** The `Set-Cookie` header value that expires the cart cookie, e.g. after a merge. */
export function clearedCartCookieHeader(): string {
  return `${CART_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
