/**
 * Prefix tokens for v1.0 search.
 *
 * Firestore has no full-text search, so `products.searchTokens` is an
 * `array-contains` index over every prefix of every word in the product's searchable
 * text. A query for "beech" becomes `where('searchTokens', 'array-contains', 'beech')`,
 * which is an index seek rather than a scan.
 *
 * The limits are real and documented rather than hidden (ADR-0002): this matches
 * prefixes of single words, so it finds "beechwood" from "beech" but not from "wood",
 * and it cannot rank, cannot facet and cannot handle typos. Typesense in v1.1 removes
 * all of that behind the same `SearchPort`. What this does buy is a search box that
 * works on day one with no second system to operate.
 *
 * **The same function must generate tokens and normalise queries.** If indexing
 * lowercased and the query did not, search would return nothing for a capitalised
 * word — and the failure is silent, because "no results" is a legitimate answer.
 */

/**
 * Longest prefix stored per word.
 *
 * Beyond this, a word is stored whole instead of continuing to emit prefixes. Ten
 * characters is enough that a searcher has almost certainly matched by then, and it
 * bounds the array: Firestore allows 40 000 index entries per document, and an
 * unbounded prefix expansion over a long description is the fastest way to find that
 * ceiling in production.
 */
const MAX_PREFIX_LENGTH = 10;

/** Shortest prefix stored. One-character prefixes match nearly everything. */
const MIN_PREFIX_LENGTH = 2;

/** Hard cap, matching the bound on `ProductDocSchema.searchTokens`. */
const MAX_TOKENS = 200;

/**
 * Splits text into normalised words.
 *
 * Diacritics are folded so "Pokémon" is found by typing "pokemon" — an Indian
 * customer on a phone keyboard will not produce the é, and a search that requires it
 * returns nothing with no explanation.
 */
export function normaliseSearchText(text: string): readonly string[] {
  return (
    text
      .normalize('NFD')
      // Strip combining marks left behind by the decomposition.
      .replaceAll(/[\u0300-\u036F]/gu, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((word) => word.length > 0)
  );
}

/**
 * Normalises a search query to the token a lookup should use.
 *
 * Returns the longest word in the query, truncated to the stored prefix length.
 * Longest rather than first because "the balance board" should search on "balance",
 * and truncating matters because a query longer than `MAX_PREFIX_LENGTH` would look
 * for a token that was never stored — so a *more specific* search would return fewer
 * results than a vaguer one, which is the opposite of what a user expects.
 *
 * Returns null when there is nothing searchable, so a caller can skip the query
 * rather than issue one that cannot match.
 */
export function searchQueryToken(query: string): string | null {
  const words = normaliseSearchText(query);
  if (words.length === 0) return null;

  const longest = words.reduce((best, word) => (word.length > best.length ? word : best));
  if (longest.length < MIN_PREFIX_LENGTH) return null;

  return longest.slice(0, MAX_PREFIX_LENGTH);
}

/**
 * Builds the stored token array for a product.
 *
 * Takes the fields worth searching rather than the whole document: name, brand, and
 * the category and age band as words. The description is deliberately excluded —
 * prefix-expanding five thousand characters produces thousands of tokens, most of them
 * from words like "and", and it turns every product into a match for almost anything.
 *
 * Sorted and deduplicated, which makes the output deterministic: the seed compares
 * stored documents against desired ones, and an array in a different order would make
 * an unchanged product look changed on every run.
 */
export function buildSearchTokens(parts: readonly string[]): readonly string[] {
  const tokens = new Set<string>();

  for (const word of parts.flatMap((part) => normaliseSearchText(part))) {
    if (word.length < MIN_PREFIX_LENGTH) {
      // A one-character word is still worth storing whole — "3" in "3-5 years", or a
      // single-letter product line — it just gets no prefix expansion.
      tokens.add(word);
      continue;
    }

    // Stops at MAX_PREFIX_LENGTH and does not also store the whole word, because
    // `searchQueryToken` truncates a query to the same bound — a longer token could
    // never be queried, so storing it would be index weight nothing reads.
    const longest = Math.min(word.length, MAX_PREFIX_LENGTH);
    for (let length = MIN_PREFIX_LENGTH; length <= longest; length += 1) {
      tokens.add(word.slice(0, length));
    }
  }

  return [...tokens].sort().slice(0, MAX_TOKENS);
}
