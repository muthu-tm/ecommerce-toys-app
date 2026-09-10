import { SlugSchema } from '@romp/contracts';
import type { Slug } from '@romp/contracts';

/**
 * Derives a URL slug from a product name.
 *
 * The storefront addresses a product by `slug`, and the admin create form should not make
 * a human invent one — but it must also produce a value the `SlugSchema` accepts, or the
 * write fails on a field the user never saw. This is the one function that turns arbitrary
 * product-name text into a valid slug, so the form's live preview and the server's fallback
 * cannot disagree about what "Beechwood Stacking Rings (2024)" becomes.
 *
 * The rules mirror `SlugSchema`: lowercase, ASCII, single hyphens between word runs, no
 * leading or trailing hyphen. Diacritics are folded rather than dropped so "Pokémon"
 * becomes "pokemon" rather than "pokmon", and everything else non-alphanumeric collapses to
 * a single hyphen.
 */

/** The slug length the schema permits. Truncation happens on a hyphen boundary, not mid-word. */
const MAX_SLUG_LENGTH = 120;

/**
 * Turns free text into a slug candidate.
 *
 * Returns an empty string when the input has nothing sluggable (all punctuation, or empty),
 * which the caller treats as "you must supply a slug" rather than writing an invalid one.
 */
export function slugify(text: string): string {
  const base = text
    .normalize('NFD')
    // Strip the combining marks the decomposition leaves behind, folding é → e.
    .replaceAll(/[\u0300-\u036F]/gu, '')
    .toLowerCase()
    // Everything that is not a lowercase alphanumeric becomes a hyphen; runs collapse.
    .replaceAll(/[^a-z0-9]+/gu, '-')
    // Trim the hyphens the previous step may have left at the ends.
    .replaceAll(/^-+|-+$/gu, '');

  if (base.length <= MAX_SLUG_LENGTH) return base;

  // Truncate to the bound, then back off to the last full word so the slug does not end on
  // a half-word or a stray hyphen.
  const clipped = base.slice(0, MAX_SLUG_LENGTH).replace(/-+[^-]*$/u, '');
  return clipped.replaceAll(/^-+|-+$/gu, '');
}

/**
 * Derives a validated `Slug`, or throws if the name yields nothing sluggable.
 *
 * The throw is deliberate: a product whose name is entirely punctuation has no reasonable
 * default slug, and inventing one (`product-1`) hides a data-entry problem behind a URL
 * nobody chose. The caller — the API create route — turns this into a field-level
 * validation error pointing at the slug.
 */
export function deriveSlug(name: string): Slug {
  const candidate = slugify(name);
  return SlugSchema.parse(candidate);
}
