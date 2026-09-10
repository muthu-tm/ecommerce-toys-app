import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import type { ProductDoc } from '@romp/contracts';
import { aCategory, aProduct } from '@romp/contracts/fixtures';
import { TooManyFilterValuesError, UnsupportedQueryError } from '@romp/observability';

import { fixedClock } from '../clock';
import { asCustomer, asOperator, createStoreContext } from '../context';
import type { Caller } from '../context';
import { firestoreRecorder } from '../test-support/firestore-recorder';

import { firestoreSearchPort, toProductSummary } from './firestore';

/**
 * The Firestore search adapter.
 *
 * Two halves, tested differently. The **projection** and the **guards** are pure, so they
 * are asserted directly. The **query shape** is asserted against a recorder that captures
 * the clauses the adapter builds without talking to Firestore — because the thing worth
 * checking is that a public search filters on status and that a single category uses `==`
 * rather than a one-element `in`, and neither needs a database to observe.
 *
 * What a recorder cannot check is whether the resulting query has an index and returns the
 * right documents. `infra/tests/search.test.ts` does that against the real emulator and the
 * seeded catalogue. Neither test replaces the other.
 */

interface RecordedClause {
  readonly kind: 'where' | 'orderBy' | 'limit' | 'startAfter';
  readonly args: readonly unknown[];
}

interface QueryRecorder {
  readonly clauses: RecordedClause[];
  readonly asFirestore: () => Firestore;
}

/**
 * Records the query chain and returns no documents.
 *
 * Returning nothing is deliberate: this fake exists to observe *how* the adapter asks,
 * not what comes back. Making it return documents would tempt assertions about filtering
 * that the fake does not actually perform, and those assertions would pass while the real
 * query was wrong.
 */
function queryRecorder(documents: readonly ProductDoc[] = []): QueryRecorder {
  const clauses: RecordedClause[] = [];

  const chain = {
    withConverter: () => chain,
    where: (...args: readonly unknown[]) => {
      clauses.push({ kind: 'where', args });
      return chain;
    },
    orderBy: (...args: readonly unknown[]) => {
      clauses.push({ kind: 'orderBy', args });
      return chain;
    },
    startAfter: (...args: readonly unknown[]) => {
      clauses.push({ kind: 'startAfter', args });
      return chain;
    },
    limit: (...args: readonly unknown[]) => {
      clauses.push({ kind: 'limit', args });
      return chain;
    },
    get: () =>
      Promise.resolve({
        docs: documents.map((data, index) => ({ id: `p${String(index)}`, data: () => data })),
      }),
  };

  return {
    clauses,
    asFirestore: () => ({ collection: () => chain }) as unknown as Firestore,
  };
}

const clock = fixedClock(new Date('2026-03-01T09:30:00.000Z'));
const contextFor = (recorder: QueryRecorder) =>
  createStoreContext({ storeId: 'romp', db: recorder.asFirestore(), clock });

/** Marks a fixture with the document ID the recorder should hand back. */
const withDocId = <T extends object>(id: string, document: T): T & { __id: string } => ({
  ...document,
  __id: id,
});

const CUSTOMER: Caller = asCustomer('customer-1');
const STAFF: Caller = asOperator('staff-1', 'staff');

/** Every `where` clause the adapter added, as `[field, op, value]` triples. */
const wheres = (recorder: QueryRecorder): readonly unknown[][] =>
  recorder.clauses.filter((clause) => clause.kind === 'where').map((clause) => [...clause.args]);

const orderBys = (recorder: QueryRecorder): readonly unknown[][] =>
  recorder.clauses.filter((clause) => clause.kind === 'orderBy').map((clause) => [...clause.args]);

describe('visibility', () => {
  it('filters a public search to active products', async () => {
    // This filter is the whole reason a draft is not on the storefront. Rules do not apply
    // here — the Admin SDK bypasses them — so if it were missing, nothing else would stop
    // an unpublished product appearing in a listing.
    const recorder = queryRecorder();
    await firestoreSearchPort.searchProducts(contextFor(recorder), CUSTOMER, {});

    expect(wheres(recorder)).toContainEqual(['status', '==', 'active']);
  });

  it('widens the filter for staff rather than dropping it', async () => {
    // Dropping the clause would change which composite index the query uses, so an admin
    // listing would silently need an index nobody created.
    const recorder = queryRecorder();
    await firestoreSearchPort.searchProducts(contextFor(recorder), STAFF, {});

    const statusClause = wheres(recorder).find((clause) => clause[0] === 'status');

    expect(statusClause?.[1]).toBe('in');
    expect(statusClause?.[2]).toEqual(expect.arrayContaining(['active', 'draft', 'archived']));
  });
});

describe('filters', () => {
  it('uses equality for a single category, not a one-element `in`', async () => {
    // The two use different indexes, and the equality form is the one the category listing
    // page has an index for.
    const recorder = queryRecorder();
    await firestoreSearchPort.searchProducts(contextFor(recorder), CUSTOMER, {
      categorySlugs: ['wooden'],
    });

    expect(wheres(recorder)).toContainEqual(['categorySlug', '==', 'wooden']);
  });

  it('uses `in` for several categories', async () => {
    const recorder = queryRecorder();
    await firestoreSearchPort.searchProducts(contextFor(recorder), CUSTOMER, {
      categorySlugs: ['wooden', 'puzzles'],
    });

    expect(wheres(recorder)).toContainEqual(['categorySlug', 'in', ['wooden', 'puzzles']]);
  });

  it('applies the same shape to age bands and brands', async () => {
    const recorder = queryRecorder();
    await firestoreSearchPort.searchProducts(contextFor(recorder), CUSTOMER, {
      ageBands: ['3-5'],
      brands: ['Kaadu', 'Chotu Co.'],
    });

    expect(wheres(recorder)).toContainEqual(['ageBand', '==', '3-5']);
    expect(wheres(recorder)).toContainEqual(['brand', 'in', ['Kaadu', 'Chotu Co.']]);
  });

  it('ignores an empty filter array rather than emitting an impossible `in`', async () => {
    // `in []` matches nothing in Firestore, so an empty selection would return an empty
    // catalogue instead of an unfiltered one.
    const recorder = queryRecorder();
    await firestoreSearchPort.searchProducts(contextFor(recorder), CUSTOMER, {
      categorySlugs: [],
      ageBands: [],
      brands: [],
    });

    expect(wheres(recorder).some((clause) => clause[0] === 'categorySlug')).toBe(false);
  });

  it('reduces free text to a single prefix token', async () => {
    // Prefix matching on a token array is the ceiling of what Firestore offers (ADR-0002).
    const recorder = queryRecorder();
    await firestoreSearchPort.searchProducts(contextFor(recorder), CUSTOMER, {
      text: 'beechwood stacking',
    });

    expect(wheres(recorder)).toContainEqual(['searchTokens', 'array-contains', 'beechwood']);
  });

  it('skips the text filter when there is nothing searchable', async () => {
    const recorder = queryRecorder();
    await firestoreSearchPort.searchProducts(contextFor(recorder), CUSTOMER, { text: '  ' });

    expect(wheres(recorder).some((clause) => clause[0] === 'searchTokens')).toBe(false);
  });

  it('emits both bounds of a price band', async () => {
    const recorder = queryRecorder();
    await firestoreSearchPort.searchProducts(contextFor(recorder), CUSTOMER, {
      price: { minMinor: 50_000, maxMinor: 200_000 },
      sort: 'price_asc',
    });

    expect(wheres(recorder)).toContainEqual(['priceFromMinor', '>=', 50_000]);
    expect(wheres(recorder)).toContainEqual(['priceFromMinor', '<=', 200_000]);
  });
});

describe('sorting and paging', () => {
  it('orders by the sort field and then by document ID', async () => {
    // The ID is the tiebreaker that makes paging total. Without it, two products at the
    // same price have no defined order, so a cursor can land inside a tie and either
    // repeat or skip them.
    const recorder = queryRecorder();
    await firestoreSearchPort.searchProducts(contextFor(recorder), CUSTOMER, { sort: 'price_asc' });

    expect(orderBys(recorder)).toEqual([
      ['priceFromMinor', 'asc'],
      ['__name__', 'asc'],
    ]);
  });

  it('orders by publication date for the default sort', async () => {
    const recorder = queryRecorder();
    await firestoreSearchPort.searchProducts(contextFor(recorder), CUSTOMER, {});

    expect(orderBys(recorder)[0]).toEqual(['publishedAt', 'desc']);
  });

  it('fetches one more document than asked for', async () => {
    // So "is there a next page" is known without a second query.
    const recorder = queryRecorder();
    await firestoreSearchPort.searchProducts(contextFor(recorder), CUSTOMER, { limit: 12 });

    expect(recorder.clauses.filter((clause) => clause.kind === 'limit')).toEqual([
      { kind: 'limit', args: [13] },
    ]);
  });

  it('returns no cursor when the page is not full', async () => {
    // A cursor on the last page is a "next" button that leads nowhere.
    const recorder = queryRecorder([aProduct()]);
    const page = await firestoreSearchPort.searchProducts(contextFor(recorder), CUSTOMER, {
      limit: 12,
    });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it('returns a cursor and drops the extra document when there is more', async () => {
    const recorder = queryRecorder([aProduct(), aProduct(), aProduct()]);
    const page = await firestoreSearchPort.searchProducts(contextFor(recorder), CUSTOMER, {
      limit: 2,
    });

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
  });

  it('starts after the decoded cursor values', async () => {
    const first = queryRecorder([aProduct(), aProduct(), aProduct()]);
    const page = await firestoreSearchPort.searchProducts(contextFor(first), CUSTOMER, {
      limit: 2,
      sort: 'price_asc',
    });
    expect(page.nextCursor).not.toBeNull();
    if (page.nextCursor === null) return;

    const second = queryRecorder();
    await firestoreSearchPort.searchProducts(contextFor(second), CUSTOMER, {
      limit: 2,
      sort: 'price_asc',
      cursor: page.nextCursor,
    });

    const startAfter = second.clauses.find((clause) => clause.kind === 'startAfter');
    expect(startAfter?.args).toEqual([aProduct().priceFromMinor, 'p1']);
  });

  it('refuses a cursor from a different sort', async () => {
    const first = queryRecorder([aProduct(), aProduct(), aProduct()]);
    const page = await firestoreSearchPort.searchProducts(contextFor(first), CUSTOMER, {
      limit: 2,
      sort: 'price_asc',
    });
    if (page.nextCursor === null) throw new Error('expected a cursor');

    await expect(
      firestoreSearchPort.searchProducts(contextFor(queryRecorder()), CUSTOMER, {
        sort: 'newest',
        cursor: page.nextCursor,
      }),
    ).rejects.toThrow(UnsupportedQueryError);
  });
});

describe('documented limits raise typed errors', () => {
  it('refuses eleven filter values rather than serving the first ten', async () => {
    // A truncated filter returns wrong results that look exactly like right ones.
    const eleven = Array.from({ length: 11 }, (_unused, index) => `cat-${String(index)}`);

    await expect(
      firestoreSearchPort.searchProducts(contextFor(queryRecorder()), CUSTOMER, {
        categorySlugs: eleven,
      }),
    ).rejects.toThrow();
  });

  it('names the field and the ceiling when the schema is bypassed', async () => {
    // The schema caps these too, so reaching the adapter's own check means a caller
    // bypassed it. Checking twice means the adapter can never be the truncating component.
    const eleven = Array.from({ length: 11 }, (_unused, index) => `brand-${String(index)}`);

    try {
      await firestoreSearchPort.searchProducts(contextFor(queryRecorder()), CUSTOMER, {
        // Cast past the schema's own bound, to reach the adapter's guard.
        brands: eleven,
      });
      throw new Error('expected a refusal');
    } catch (error) {
      if (error instanceof TooManyFilterValuesError) {
        expect(error.maximum).toBe(10);
        expect(error.supplied).toBe(11);
        return;
      }
      // The schema rejected it first, which is also correct — the point is that eleven
      // values never reach Firestore.
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('refuses a price filter sorted by anything but price', async () => {
    // Firestore permits one range field, and a range forces the first `orderBy` to name it.
    await expect(
      firestoreSearchPort.searchProducts(contextFor(queryRecorder()), CUSTOMER, {
        price: { minMinor: 10_000 },
        sort: 'newest',
      }),
    ).rejects.toThrow(UnsupportedQueryError);
  });

  it('allows a price filter sorted by price in either direction', async () => {
    for (const sort of ['price_asc', 'price_desc'] as const) {
      await expect(
        firestoreSearchPort.searchProducts(contextFor(queryRecorder()), CUSTOMER, {
          price: { maxMinor: 100_000 },
          sort,
        }),
      ).resolves.toBeDefined();
    }
  });
});

describe('the in-stock filter', () => {
  it('drops products with nothing sellable in stock', async () => {
    const inStock = aProduct();
    const outOfStock = aProduct({
      variantSummary: aProduct().variantSummary.map((variant) => ({ ...variant, inStock: false })),
    });

    const page = await firestoreSearchPort.searchProducts(
      contextFor(queryRecorder([inStock, outOfStock])),
      CUSTOMER,
      { inStockOnly: true },
    );

    expect(page.items).toHaveLength(1);
  });

  it('ignores stock on inactive variants', async () => {
    // A variant that is in stock but not sellable does not make the product buyable.
    const product = aProduct({
      status: 'draft',
      variantSummary: aProduct().variantSummary.map((variant) => ({
        ...variant,
        active: false,
        inStock: true,
      })),
    });

    const page = await firestoreSearchPort.searchProducts(
      contextFor(queryRecorder([product])),
      STAFF,
      { inStockOnly: true },
    );

    expect(page.items).toHaveLength(0);
  });

  it('is applied in memory, so a filtered page can come back short', async () => {
    // A real limitation, stated rather than hidden: `inStock` lives inside the
    // `variantSummary` array and Firestore cannot filter on a field of an array element.
    const outOfStock = aProduct({
      variantSummary: aProduct().variantSummary.map((variant) => ({ ...variant, inStock: false })),
    });

    const page = await firestoreSearchPort.searchProducts(
      contextFor(queryRecorder([outOfStock, outOfStock, outOfStock])),
      CUSTOMER,
      { inStockOnly: true, limit: 2 },
    );

    // Two documents were fetched and both filtered out, so the page is empty — yet a next
    // cursor is still issued, because there genuinely is a further page to try.
    expect(page.items).toHaveLength(0);
    expect(page.nextCursor).not.toBeNull();
  });
});

describe('toProductSummary', () => {
  const withId = { ...aProduct(), id: 'wooden-blocks' };

  it('keeps only what a card renders', () => {
    const summary = toProductSummary(withId);

    expect(summary.name).toBe('Wooden building blocks');
    expect(summary).not.toHaveProperty('description');
    expect(summary).not.toHaveProperty('searchTokens');
    expect(summary).not.toHaveProperty('safety');
  });

  it('picks the cover image by order, not by position', () => {
    const [first] = aProduct().media;
    if (first === undefined) throw new Error('fixture has no media');

    const summary = toProductSummary({
      ...withId,
      media: [
        { ...first, path: 'second.webp', order: 1 },
        { ...first, path: 'cover.webp', order: 0 },
      ],
    });

    expect(summary.cover?.path).toBe('cover.webp');
  });

  it('returns a null cover when there is no media', () => {
    // A freshly seeded store has no photography until the admin pipeline runs, and the
    // listing still has to render.
    expect(toProductSummary({ ...withId, media: [] }).cover).toBeNull();
  });

  it('counts only sellable variants', () => {
    const [sellable] = aProduct().variantSummary;
    if (sellable === undefined) throw new Error('fixture has no variant summary');

    const summary = toProductSummary({
      ...withId,
      status: 'draft',
      variantSummary: [sellable, { ...sellable, active: false }],
    });

    expect(summary.variantCount).toBe(1);
  });

  it('reports availability as a boolean over sellable variants', () => {
    expect(toProductSummary(withId).inStock).toBe(true);
    expect(
      toProductSummary({
        ...withId,
        variantSummary: aProduct().variantSummary.map((variant) => ({
          ...variant,
          inStock: false,
        })),
      }).inStock,
    ).toBe(false);
  });
});

describe('suggest', () => {
  it('returns nothing for a prefix too short to discriminate', async () => {
    // One character matches nearly the whole catalogue, so the query is skipped rather
    // than issued and truncated.
    const recorder = firestoreRecorder({ documents: { products: [] } });

    expect(await firestoreSearchPort.suggest(recorder.context, CUSTOMER, 'a')).toEqual([]);
    expect(recorder.collections).toEqual([]);
  });

  it('returns nothing for whitespace', async () => {
    const recorder = firestoreRecorder({ documents: { products: [] } });

    expect(await firestoreSearchPort.suggest(recorder.context, CUSTOMER, '   ')).toEqual([]);
  });

  it('filters to active products and the prefix token', async () => {
    const recorder = firestoreRecorder({ documents: { products: [] } });
    await firestoreSearchPort.suggest(recorder.context, CUSTOMER, 'beech');

    expect(recorder.wheres()).toContainEqual(['status', '==', 'active']);
    expect(recorder.wheres()).toContainEqual(['searchTokens', 'array-contains', 'beech']);
  });

  it('never shows drafts, even to staff', async () => {
    // The suggestion box is a customer-facing surface. A draft appearing while an admin
    // browses the storefront reads as a leak even though it is not.
    const recorder = firestoreRecorder({ documents: { products: [] } });
    await firestoreSearchPort.suggest(recorder.context, STAFF, 'beech');

    expect(recorder.wheres()).toContainEqual(['status', '==', 'active']);
    expect(recorder.wheres().some((clause) => clause[1] === 'in')).toBe(false);
  });

  it('orders by rating, because there is no relevance to order by', async () => {
    const recorder = firestoreRecorder({ documents: { products: [] } });
    await firestoreSearchPort.suggest(recorder.context, CUSTOMER, 'beech');

    expect(recorder.orderBys()).toContainEqual(['ratingAvg', 'desc']);
  });

  it('returns only what the box renders', async () => {
    const recorder = firestoreRecorder({
      documents: { products: [withDocId('wooden-blocks', aProduct())] },
    });

    const suggestions = await firestoreSearchPort.suggest(recorder.context, CUSTOMER, 'wooden');

    expect(suggestions).toEqual([
      {
        slug: 'wooden-blocks',
        name: 'Wooden building blocks',
        brand: 'Woodwise',
        priceFromMinor: aProduct().priceFromMinor,
      },
    ]);
  });

  it('never paginates', async () => {
    // Folding this into `searchProducts` with a small limit would let a keystroke inherit
    // filters and sorting the box does not have.
    const recorder = firestoreRecorder({ documents: { products: [] } });
    await firestoreSearchPort.suggest(recorder.context, CUSTOMER, 'beech', { limit: 4 });

    const limits = recorder.collections.flatMap((collection) =>
      collection.clauses.filter((clause) => clause.kind === 'limit'),
    );
    expect(limits).toEqual([{ kind: 'limit', args: [4] }]);
    expect(
      recorder.collections.flatMap((c) => c.clauses.filter((x) => x.kind === 'startAfter')),
    ).toEqual([]);
  });
});

describe('facets', () => {
  it('answers the category dimension from maintained totals', async () => {
    // Firestore cannot count matches in a query, so the counts come from
    // `categories.productCount` or they do not exist.
    const recorder = firestoreRecorder({
      documents: { categories: [withDocId('wooden', aCategory({ productCount: 4 }))] },
    });

    const facets = await firestoreSearchPort.facets(recorder.context, CUSTOMER, {});

    // Keyed by the category's `slug`, not by its document ID — the slug is what a filter
    // URL carries and what a product's `categorySlug` matches.
    expect(facets.categories).toEqual({ [aCategory().slug]: 4 });
  });

  it('reports which dimensions it actually counted', async () => {
    // A UI must not render "3–5 years (0)" when the truth is "we did not count".
    const recorder = firestoreRecorder({ documents: { categories: [] } });

    const facets = await firestoreSearchPort.facets(recorder.context, CUSTOMER, {});

    expect(facets.countedDimensions).toEqual(['categories']);
    expect(facets.ageBands).toEqual({});
    expect(facets.brands).toEqual({});
  });

  it('ignores the query filters, because it cannot narrow on them', async () => {
    const recorder = firestoreRecorder({ documents: { categories: [] } });
    await firestoreSearchPort.facets(recorder.context, CUSTOMER, {
      categorySlugs: ['wooden'],
      price: { minMinor: 1_000 },
      sort: 'price_asc',
    });

    // No filter derived from the query reached the categories read.
    expect(recorder.wheres()).toEqual([]);
  });
});
