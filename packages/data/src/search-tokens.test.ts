import { describe, expect, it } from 'vitest';

import { buildSearchTokens, normaliseSearchText, searchQueryToken } from './search-tokens';

/**
 * Prefix-token search.
 *
 * The property that matters most is the round trip: whatever `searchQueryToken` produces
 * for a query must be something `buildSearchTokens` actually stored. If the two disagree
 * the search box returns nothing, and the failure is silent — "no results" is a
 * legitimate answer, so nobody reports it as a bug.
 */

describe('normaliseSearchText', () => {
  it('lowercases and splits on non-alphanumerics', () => {
    expect(normaliseSearchText('Beechwood Stacking Rings')).toEqual([
      'beechwood',
      'stacking',
      'rings',
    ]);
  });

  it('splits on punctuation and collapses runs of it', () => {
    expect(normaliseSearchText('6–8 yrs · 240 pcs')).toEqual(['6', '8', 'yrs', '240', 'pcs']);
  });

  it('folds diacritics', () => {
    // An Indian customer on a phone keyboard will not produce the é, and a search that
    // requires it returns nothing with no explanation.
    expect(normaliseSearchText('Pokémon')).toEqual(['pokemon']);
    expect(normaliseSearchText('Crème brûlée')).toEqual(['creme', 'brulee']);
  });

  it('returns nothing for text with no searchable characters', () => {
    expect(normaliseSearchText('   ')).toEqual([]);
    expect(normaliseSearchText('— · —')).toEqual([]);
    expect(normaliseSearchText('')).toEqual([]);
  });

  it('keeps digits, which carry meaning in a toy catalogue', () => {
    expect(normaliseSearchText('500 pieces')).toEqual(['500', 'pieces']);
  });
});

describe('buildSearchTokens', () => {
  it('stores every prefix from two characters up', () => {
    expect(buildSearchTokens(['rings'])).toEqual(['ri', 'rin', 'ring', 'rings']);
  });

  it('does not store one-character prefixes', () => {
    // A single character matches nearly everything, so it is index weight with no
    // discriminating power.
    expect(buildSearchTokens(['rings'])).not.toContain('r');
  });

  it('stores a one-character word whole', () => {
    // Still worth finding — "3" in "3-5 years", or a single-letter product line — it
    // just gets no prefix expansion.
    expect(buildSearchTokens(['3 piece'])).toContain('3');
  });

  it('caps prefixes at ten characters and stores nothing longer', () => {
    const tokens = buildSearchTokens(['extraordinarily']);

    expect(tokens).toContain('extraordi');
    expect(tokens).toContain('extraordin');
    expect(tokens.every((token) => token.length <= 10)).toBe(true);
    expect(tokens).not.toContain('extraordinarily');
  });

  it('covers every word, not just the first', () => {
    const tokens = buildSearchTokens(['Beechwood stacking rings']);

    expect(tokens).toContain('beech');
    expect(tokens).toContain('stack');
    expect(tokens).toContain('ring');
  });

  it('matches a prefix of a word but not an interior substring', () => {
    // The documented limit (ADR-0002): "beech" finds "beechwood", "wood" does not.
    const tokens = buildSearchTokens(['beechwood']);

    expect(tokens).toContain('beech');
    expect(tokens).not.toContain('wood');
  });

  it('merges several fields and deduplicates', () => {
    const tokens = buildSearchTokens(['Rings', 'rings', 'RINGS']);

    expect(tokens.filter((token) => token === 'rings')).toHaveLength(1);
  });

  it('returns tokens sorted, so an unchanged product looks unchanged', () => {
    const tokens = buildSearchTokens(['zebra apple mango']);

    expect([...tokens]).toEqual([...tokens].sort());
  });

  it('bounds the array so a document cannot exceed the Firestore index limit', () => {
    const manyWords = Array.from({ length: 500 }, (_unused, index) => `word${String(index)}`).join(
      ' ',
    );

    expect(buildSearchTokens([manyWords]).length).toBeLessThanOrEqual(200);
  });

  it('returns nothing for empty input', () => {
    expect(buildSearchTokens([])).toEqual([]);
    expect(buildSearchTokens(['', '   '])).toEqual([]);
  });
});

describe('searchQueryToken', () => {
  it('normalises a query the same way indexing does', () => {
    expect(searchQueryToken('BEECH')).toBe('beech');
    expect(searchQueryToken('Pokémon')).toBe('pokemon');
  });

  it('picks the longest word, not the first', () => {
    // "the balance board" should search on "balance".
    expect(searchQueryToken('the balance')).toBe('balance');
  });

  it('truncates to the stored prefix length', () => {
    // Without this, a longer and more specific query looks for a token that was never
    // stored — so a more specific search would return fewer results than a vaguer one.
    expect(searchQueryToken('extraordinarily')).toBe('extraordin');
  });

  it('returns null when there is nothing to search on', () => {
    expect(searchQueryToken('')).toBeNull();
    expect(searchQueryToken('   ')).toBeNull();
    expect(searchQueryToken('a')).toBeNull();
  });

  it('round-trips against the tokens that were stored', () => {
    const stored = new Set(buildSearchTokens(['Beechwood stacking rings', 'Kaadu']));

    for (const query of ['beech', 'BEECHWOOD', 'stacking', 'Kaadu', 'rings']) {
      const token = searchQueryToken(query);
      expect(token).not.toBeNull();
      if (token === null) continue;
      expect(stored.has(token)).toBe(true);
    }
  });

  it('round-trips a query longer than the stored prefix length', () => {
    const stored = new Set(buildSearchTokens(['extraordinarily good blocks']));
    const token = searchQueryToken('extraordinarily');

    expect(token).not.toBeNull();
    if (token === null) return;
    expect(stored.has(token)).toBe(true);
  });
});
