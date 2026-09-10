import { describe, expect, it } from 'vitest';

import { deriveSlug, slugify } from './slug';

describe('slugify', () => {
  it('lowercases and hyphenates a plain name', () => {
    expect(slugify('Wooden Blocks')).toBe('wooden-blocks');
  });

  it('collapses runs of punctuation and spaces to a single hyphen', () => {
    expect(slugify('Beechwood Stacking Rings (2024)')).toBe('beechwood-stacking-rings-2024');
  });

  it('folds diacritics rather than dropping the letter', () => {
    expect(slugify('Pokémon Cards')).toBe('pokemon-cards');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  !Hello!  ')).toBe('hello');
  });

  it('returns empty for text with nothing sluggable', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify('')).toBe('');
  });

  it('truncates on a word boundary, never mid-word or on a trailing hyphen', () => {
    const long = `${'wooden '.repeat(30)}blocks`;
    const slug = slugify(long);

    expect(slug.length).toBeLessThanOrEqual(120);
    expect(slug.startsWith('wooden-wooden')).toBe(true);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('deriveSlug', () => {
  it('returns a validated Slug for a normal name', () => {
    expect(deriveSlug('Wooden Blocks')).toBe('wooden-blocks');
  });

  it('throws when the name yields nothing sluggable rather than inventing one', () => {
    // A product named entirely in punctuation has no defensible default slug; the API
    // turns this into a field-level error rather than writing an invalid document.
    expect(() => deriveSlug('!!!')).toThrow();
  });
});
