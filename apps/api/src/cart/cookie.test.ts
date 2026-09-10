import { describe, expect, it } from 'vitest';

import {
  CART_COOKIE_NAME,
  cartCookieHeader,
  newCartId,
  readCartCookie,
  signCartId,
  verifyCartCookie,
} from './cookie';

/**
 * The signed cart cookie. The concern is that a cart ID round-trips through sign/verify, and that a
 * forged or tampered cookie verifies to null — the property that lets a guest cart be reachable by
 * cookie without being forgeable.
 */

const SECRET = 'a-test-secret';

describe('signCartId / verifyCartCookie', () => {
  it('round-trips a cart ID', () => {
    const id = newCartId();
    const signed = signCartId(id, SECRET);
    expect(verifyCartCookie(signed, SECRET)).toBe(id);
  });

  it('rejects a value with no signature', () => {
    expect(verifyCartCookie('just-an-id', SECRET)).toBeNull();
  });

  it('rejects a tampered cart ID', () => {
    const signed = signCartId('cart-123', SECRET);
    const tampered = signed.replace('cart-123', 'cart-999');
    expect(verifyCartCookie(tampered, SECRET)).toBeNull();
  });

  it('rejects a value signed with a different secret', () => {
    const signed = signCartId('cart-123', 'other-secret');
    expect(verifyCartCookie(signed, SECRET)).toBeNull();
  });

  it('rejects undefined', () => {
    expect(verifyCartCookie(undefined, SECRET)).toBeNull();
  });

  it('rejects a non-hex signature of the wrong length', () => {
    expect(verifyCartCookie('cart-123.zzzz', SECRET)).toBeNull();
  });
});

describe('readCartCookie', () => {
  it('extracts the cart cookie from a Cookie header among others', () => {
    const header = `session=abc; ${CART_COOKIE_NAME}=cart-123.sig; other=x`;
    expect(readCartCookie(header)).toBe('cart-123.sig');
  });

  it('returns undefined when absent', () => {
    expect(readCartCookie('session=abc')).toBeUndefined();
    expect(readCartCookie(undefined)).toBeUndefined();
  });
});

describe('cartCookieHeader', () => {
  it('builds an HttpOnly, Secure, Lax cookie with the signed value', () => {
    const header = cartCookieHeader('cart-123', SECRET);
    expect(header).toContain(`${CART_COOKIE_NAME}=cart-123.`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Max-Age=');
  });
});
