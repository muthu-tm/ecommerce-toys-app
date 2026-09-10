import { describe, expect, it } from 'vitest';

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MIN_SCORE,
  assessPassword,
} from './password';

describe('assessPassword', () => {
  it('rejects a password below the minimum length before estimating strength', () => {
    const result = assessPassword('short');
    expect(result.ok).toBe(false);
    expect(result.suggestions[0]).toContain(String(PASSWORD_MIN_LENGTH));
  });

  it('rejects a password over the maximum length', () => {
    const result = assessPassword('a'.repeat(PASSWORD_MAX_LENGTH + 1));
    expect(result.ok).toBe(false);
    expect(result.suggestions[0]).toContain(String(PASSWORD_MAX_LENGTH));
  });

  it('accepts a long, unpredictable passphrase', () => {
    const result = assessPassword('correct-horse-battery-staple-2718');
    expect(result.ok).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(PASSWORD_MIN_SCORE);
  });

  it('rejects a long but predictable password', () => {
    // Long enough to pass the length gate, but a top-of-the-list common password pattern.
    const result = assessPassword('password123');
    expect(result.ok).toBe(false);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it('penalises a password derived from the identifier', () => {
    const result = assessPassword('aditisharma99', { identifier: 'aditisharma@example.com' });
    expect(result.ok).toBe(false);
  });

  it('penalises a password built from the brand name', () => {
    // A password built from the brand is the first thing an attacker on this store tries.
    // Feeding the brand in as a zxcvbn user-input drops this one below the floor, where
    // without the brand context it would pass — which is exactly the protection intended.
    const withBrand = assessPassword('romp romp romp', { brandNames: ['ROMP', 'ROMP Retail'] });
    const withoutBrand = assessPassword('romp romp romp');
    expect(withBrand.ok).toBe(false);
    expect(withBrand.score).toBeLessThan(withoutBrand.score);
  });

  it('always returns at least one suggestion when it fails', () => {
    const result = assessPassword('aaaaaaaaaa');
    expect(result.ok).toBe(false);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it('surfaces zxcvbn feedback when it produces any', () => {
    // A repeated-word / sequence password zxcvbn recognises and warns about — exercises the
    // path where feedback is non-empty rather than the generic fallback.
    const result = assessPassword('abcabcabcabc');
    expect(result.ok).toBe(false);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it('ignores an identifier with no local part before the @', () => {
    // `@example.com` has the @ at position 0, so there is no local part to add as an input.
    const result = assessPassword('velvet thunder maple orbit', { identifier: '@example.com' });
    expect(result.ok).toBe(true);
  });

  it('accepts a strong password when no context is supplied', () => {
    // Exercises the empty-context path: no identifier, no brand names.
    expect(assessPassword('velvet thunder maple orbit').ok).toBe(true);
  });

  it('handles an empty identifier and empty brand names without treating them as inputs', () => {
    // Empty strings must not be pushed as zxcvbn user inputs, or every password "contains"
    // them.
    const result = assessPassword('velvet thunder maple orbit', {
      identifier: '',
      brandNames: [''],
    });
    expect(result.ok).toBe(true);
  });

  it('penalises the local part of an email identifier', () => {
    // The @-split branch: a password echoing just the local part is weak too.
    const result = assessPassword('sunflower sunflower', {
      identifier: 'sunflower@example.com',
    });
    expect(result.score).toBeLessThan(4);
  });

  it('does not enforce composition rules — a long lowercase passphrase can pass', () => {
    // No uppercase, no digit, no symbol. Composition rules would reject this; the strength
    // estimator does not, which is the point.
    const result = assessPassword('velvet thunder maple orbit river');
    expect(result.ok).toBe(true);
  });
});
