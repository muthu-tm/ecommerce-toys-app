import { describe, expect, it } from 'vitest';

import { ADMIN_NAV, isAdminNavActive } from './admin-nav';

describe('isAdminNavActive', () => {
  it('treats product edit paths as the Products section', () => {
    expect(isAdminNavActive('/products/abc', '/')).toBe(true);
    expect(isAdminNavActive('/products/new', '/')).toBe(true);
    expect(isAdminNavActive('/', '/')).toBe(true);
  });

  it('does not treat the product list as Overview', () => {
    expect(isAdminNavActive('/', '/dashboard')).toBe(false);
    expect(isAdminNavActive('/products/abc', '/dashboard')).toBe(false);
  });

  it('matches nested paths for every other section', () => {
    expect(isAdminNavActive('/orders/xyz', '/orders')).toBe(true);
    expect(isAdminNavActive('/categories', '/categories')).toBe(true);
    expect(isAdminNavActive('/reviews', '/reviews')).toBe(true);
    expect(isAdminNavActive('/dashboard', '/dashboard')).toBe(true);
  });

  it('lists only routes the backoffice actually serves', () => {
    expect(ADMIN_NAV.map((item) => item.href)).toEqual([
      '/dashboard',
      '/orders',
      '/',
      '/categories',
      '/reviews',
    ]);
  });
});
