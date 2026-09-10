import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import type { ProductDoc, VariantDoc } from '@romp/contracts';
import { money } from '@romp/contracts';
import { aProduct, aVariant } from '@romp/contracts/fixtures';

import { fixedClock } from '../clock';
import { ANONYMOUS, asOperator, asSystem, createStoreContext } from '../context';
import type { StoreContext } from '../context';
import { converters } from '../converters';

import {
  IllegalProductTransitionError,
  NoActiveVariantError,
  ProductNotFoundError,
  VariantNotFoundError,
  createProduct,
  createVariant,
  finalizeProductMedia,
  registerMediaSlot,
  setProductStatus,
  updateProduct,
  updateVariant,
} from './catalogue-write';

/**
 * Unit tests for the catalogue write repository.
 *
 * These use a transaction-capable Firestore double to assert the orchestration a real
 * database cannot show cheaply: that a write is staff-gated, that a missing product or
 * variant throws the specific error the API maps, that a status change respects the machine
 * and the active-variant rule, and — the property that matters most — that a variant write
 * and the product-summary refresh happen with **all reads before all writes**, the ordering
 * Firestore enforces. The end-to-end behaviour against real Firestore is in
 * `infra/tests/catalogue-write.test.ts`; here the concern is the control flow.
 */

const NOW = new Date('2026-03-01T09:30:00.000Z');
const STAFF = asOperator('staff-1', 'staff');
const SYSTEM = asSystem('finalize');

interface StoredDoc {
  readonly path: string;
  data: Record<string, unknown>;
}

/**
 * A minimal transaction-capable Firestore double.
 *
 * It stores decoded documents by path and enforces the one rule the tests exist to check:
 * a `tx.get` after a `tx.set` throws, exactly as Firestore does. Converters are honoured, so
 * a document that would fail its schema fails here too.
 */
function fakeDb(seed: readonly StoredDoc[] = []) {
  const store = new Map<string, Record<string, unknown>>(seed.map((d) => [d.path, d.data]));
  let generated = 0;

  interface Converter {
    toFirestore: (v: unknown) => Record<string, unknown>;
    fromFirestore: (s: { id: string; data: () => unknown }) => unknown;
  }

  const snapshotOf = (path: string, converter: Converter | null) => {
    const raw = store.get(path);
    const id = path.split('/').at(-1) ?? '';
    return {
      id,
      exists: raw !== undefined,
      data: () =>
        raw === undefined
          ? undefined
          : converter === null
            ? raw
            : converter.fromFirestore({ id, data: () => raw }),
    };
  };

  const docRef = (path: string) => {
    let converter: Converter | null = null;
    const ref = {
      path,
      id: path.split('/').at(-1) ?? '',
      withConverter: (c: Converter) => {
        converter = c;
        return ref;
      },
      get converter() {
        return converter;
      },
    };
    return ref;
  };

  const collectionRef = (path: string) => {
    let converter: Converter | null = null;
    const ref = {
      path,
      withConverter: (c: Converter) => {
        converter = c;
        return ref;
      },
      doc: () => {
        generated += 1;
        return docRef(`${path}/generated-${String(generated)}`);
      },
      add: (data: unknown) => {
        generated += 1;
        const id = `generated-${String(generated)}`;
        const encoded = converter === null ? data : converter.toFirestore(data);
        store.set(`${path}/${id}`, encoded as Record<string, unknown>);
        return Promise.resolve({ id });
      },
      get converter() {
        return converter;
      },
    };
    return ref;
  };

  type DocRef = ReturnType<typeof docRef>;
  type CollectionRef = ReturnType<typeof collectionRef>;

  const runTransaction = async <T>(
    fn: (tx: {
      get: (ref: DocRef | CollectionRef) => Promise<unknown>;
      set: (ref: DocRef, data: unknown) => void;
    }) => Promise<T>,
  ): Promise<T> => {
    let hasWritten = false;
    const staged: { path: string; data: Record<string, unknown> }[] = [];

    const tx = {
      get: (ref: DocRef | CollectionRef) => {
        if (hasWritten) {
          throw new Error('Firestore transactions require all reads to be executed before writes.');
        }
        if ('doc' in ref) {
          // Collection query: return docs under this path prefix.
          const prefix = `${ref.path}/`;
          const docs = [...store.entries()]
            .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
            .map(([key, raw]) => {
              const id = key.slice(prefix.length);
              return {
                id,
                data: () =>
                  ref.converter === null
                    ? raw
                    : ref.converter.fromFirestore({ id, data: () => raw }),
              };
            });
          return Promise.resolve({ docs });
        }
        return Promise.resolve(snapshotOf(ref.path, ref.converter));
      },
      set: (ref: DocRef, data: unknown) => {
        hasWritten = true;
        const encoded = ref.converter === null ? data : ref.converter.toFirestore(data);
        staged.push({ path: ref.path, data: encoded as Record<string, unknown> });
      },
    };

    const result = await fn(tx);
    for (const write of staged) store.set(write.path, write.data);
    return result;
  };

  const db = {
    doc: docRef,
    collection: collectionRef,
    runTransaction,
  } as unknown as Firestore;

  return { db, store };
}

function ctxWith(db: Firestore): StoreContext {
  return createStoreContext({ storeId: 'romp', db, clock: fixedClock(NOW) });
}

function draftDoc(overrides: Partial<ProductDoc> = {}): ProductDoc {
  return aProduct({
    status: 'draft',
    variantSummary: [],
    priceFromMinor: money(0),
    mrpFromMinor: money(0),
    publishedAt: null,
    media: [],
    seo: { title: null, description: null, index: false },
    ...overrides,
  });
}

function activeVariantDoc(overrides: Partial<VariantDoc> = {}): VariantDoc {
  return aVariant({
    priceMinor: money(2_00_000),
    mrpMinor: money(2_50_000),
    active: true,
    ...overrides,
  });
}

/** Encodes a product to its stored form so the fake can read it back through the converter. */
function storedProduct(path: string, doc: ProductDoc): StoredDoc {
  return { path, data: converters.products.toFirestore(doc) };
}

describe('staff gating', () => {
  it('refuses createProduct for a non-staff caller', async () => {
    const { db } = fakeDb();
    await expect(createProduct(ctxWith(db), ANONYMOUS, draftDoc())).rejects.toThrow();
  });

  it('allows a system caller (the media finalize Function)', async () => {
    const { db } = fakeDb([storedProduct('products/p1', draftDoc({ media: [] }))]);
    // A no-op finalize on a product with no matching media path still succeeds for system.
    await expect(
      finalizeProductMedia(ctxWith(db), SYSTEM, 'p1', 'products/p1/missing.webp', null),
    ).resolves.toBeUndefined();
  });
});

describe('createProduct', () => {
  it('adds a product and returns the generated id', async () => {
    const { db, store } = fakeDb();
    const { id } = await createProduct(ctxWith(db), STAFF, draftDoc());

    expect(id).toContain('generated-');
    expect(store.has(`products/${id}`)).toBe(true);
  });
});

describe('missing documents throw the specific error', () => {
  it('updateProduct on an absent product throws ProductNotFoundError', async () => {
    const { db } = fakeDb();
    await expect(
      updateProduct(ctxWith(db), STAFF, 'ghost', {
        name: 'X',
        description: 'Y',
        brand: 'B',
        categoryId: draftDoc().categoryId,
        categorySlug: draftDoc().categorySlug,
        ageBand: draftDoc().ageBand,
        badge: null,
        skills: [],
        boxItems: [],
        safety: draftDoc().safety,
        media: [],
        searchTokens: ['wo', 'woo'],
        seo: { title: null, description: null, index: false },
      }),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it('updateVariant on an absent variant throws VariantNotFoundError', async () => {
    const { db } = fakeDb([storedProduct('products/p1', draftDoc())]);
    await expect(
      updateVariant(ctxWith(db), STAFF, 'p1', 'ghost', {
        name: 'X',
        sku: activeVariantDoc().sku,
        priceMinor: money(1000),
        mrpMinor: money(1000),
        options: {},
        active: true,
        weightGrams: 100,
      }),
    ).rejects.toBeInstanceOf(VariantNotFoundError);
  });
});

describe('setProductStatus', () => {
  it('throws NoActiveVariantError when publishing with no active variant', async () => {
    const { db } = fakeDb([storedProduct('products/p1', draftDoc())]);
    await expect(setProductStatus(ctxWith(db), STAFF, 'p1', 'active')).rejects.toBeInstanceOf(
      NoActiveVariantError,
    );
  });

  it('throws IllegalProductTransitionError for archived -> active', async () => {
    const { db } = fakeDb([
      storedProduct(
        'products/p1',
        aProduct({
          status: 'archived',
          variantSummary: [],
          priceFromMinor: money(0),
          mrpFromMinor: money(0),
          publishedAt: null,
          media: [],
          seo: { title: null, description: null, index: false },
        }),
      ),
    ]);
    await expect(setProductStatus(ctxWith(db), STAFF, 'p1', 'active')).rejects.toBeInstanceOf(
      IllegalProductTransitionError,
    );
  });

  it('publishes and stamps publishedAt when an active variant exists', async () => {
    const { db, store } = fakeDb([
      storedProduct(
        'products/p1',
        draftDoc({
          variantSummary: [
            {
              variantId: 'v1' as ProductDoc['variantSummary'][number]['variantId'],
              name: 'N',
              sku: activeVariantDoc().sku,
              priceMinor: money(2_00_000),
              mrpMinor: money(2_50_000),
              active: true,
              inStock: true,
            },
          ],
          priceFromMinor: money(2_00_000),
          mrpFromMinor: money(2_50_000),
        }),
      ),
    ]);

    await setProductStatus(ctxWith(db), STAFF, 'p1', 'active');

    const stored = store.get('products/p1');
    expect(stored?.status).toBe('active');
    expect(stored?.publishedAt).not.toBeNull();
    expect((stored?.seo as { index: boolean }).index).toBe(true);
  });
});

describe('variant writes keep reads before writes and refresh the summary', () => {
  it('createVariant merges the new variant and rewrites the from-price without a read-after-write', async () => {
    const { db, store } = fakeDb([storedProduct('products/p1', draftDoc())]);

    // The fake throws if a read follows a write, so a passing call proves the ordering.
    await createVariant(ctxWith(db), STAFF, 'p1', activeVariantDoc({ priceMinor: money(90_000) }));

    const stored = store.get('products/p1');
    expect((stored?.variantSummary as unknown[]).length).toBe(1);
    expect(stored?.priceFromMinor).toBe(90_000);
  });
});

describe('updateProduct', () => {
  it('rewrites editable fields, normalises media order, and bumps updatedAt', async () => {
    const { db, store } = fakeDb([
      storedProduct(
        'products/p1',
        draftDoc({
          media: [
            { path: 'a.webp', alt: 'a', width: 10, height: 10, blurhash: null, order: 5 },
            { path: 'b.webp', alt: 'b', width: 10, height: 10, blurhash: null, order: 2 },
          ],
        }),
      ),
    ]);

    await updateProduct(ctxWith(db), STAFF, 'p1', {
      name: 'Renamed',
      description: 'New description',
      brand: 'NewBrand',
      categoryId: draftDoc().categoryId,
      categorySlug: draftDoc().categorySlug,
      ageBand: draftDoc().ageBand,
      badge: 'Bestseller',
      skills: ['balance'],
      boxItems: ['1 board'],
      safety: draftDoc().safety,
      media: [
        { path: 'a.webp', alt: 'a', width: 10, height: 10, blurhash: null, order: 5 },
        { path: 'b.webp', alt: 'b', width: 10, height: 10, blurhash: null, order: 2 },
      ],
      searchTokens: ['re', 'ren'],
      seo: { title: 'Custom title', description: 'Custom desc', index: false },
    });

    const stored = store.get('products/p1');
    expect(stored?.name).toBe('Renamed');
    expect(stored?.badge).toBe('Bestseller');
    // Media order is normalised: the entry the operator ranked lowest (order 2) becomes 0.
    const media = stored?.media as { path: string; order: number }[];
    expect(media.map((item) => item.order)).toEqual([0, 1]);
    expect(media[0]?.path).toBe('b.webp');
  });
});

describe('updateVariant', () => {
  it('rewrites the variant and re-derives the product from-price atomically', async () => {
    const { db, store } = fakeDb([
      storedProduct('products/p1', draftDoc()),
      {
        path: 'products/p1/variants/v1',
        data: converters.variants.toFirestore(activeVariantDoc()),
      },
    ]);

    await updateVariant(ctxWith(db), STAFF, 'p1', 'v1', {
      name: 'Cheaper',
      sku: activeVariantDoc().sku,
      priceMinor: money(50_000),
      mrpMinor: money(60_000),
      options: { finish: 'natural' },
      active: true,
      weightGrams: 400,
    });

    const stored = store.get('products/p1');
    expect(stored?.priceFromMinor).toBe(50_000);
    const variant = store.get('products/p1/variants/v1');
    expect(variant?.name).toBe('Cheaper');
  });
});

describe('registerMediaSlot', () => {
  it('appends a pending entry and normalises the media order', async () => {
    const { db, store } = fakeDb([
      storedProduct(
        'products/p1',
        draftDoc({
          media: [
            { path: 'existing.webp', alt: 'e', width: 10, height: 10, blurhash: null, order: 0 },
          ],
        }),
      ),
    ]);

    await registerMediaSlot(ctxWith(db), STAFF, 'p1', {
      path: 'products/p1/new.webp',
      alt: 'A new image',
      width: 1,
      height: 1,
      blurhash: null,
      order: Number.MAX_SAFE_INTEGER,
    });

    const media = store.get('products/p1')?.media as { path: string; order: number }[];
    expect(media).toHaveLength(2);
    // Renumbered to a contiguous sequence; the new entry lands last.
    expect(media.map((item) => item.order)).toEqual([0, 1]);
    expect(media[1]?.path).toBe('products/p1/new.webp');
  });

  it('throws ProductNotFoundError when the product is gone', async () => {
    const { db } = fakeDb();
    await expect(
      registerMediaSlot(ctxWith(db), STAFF, 'ghost', {
        path: 'products/ghost/x.webp',
        alt: 'x',
        width: 1,
        height: 1,
        blurhash: null,
        order: 0,
      }),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
  });
});

describe('finalizeProductMedia', () => {
  it('fills width, height and blurhash on the matching entry', async () => {
    const { db, store } = fakeDb([
      storedProduct(
        'products/p1',
        draftDoc({
          media: [
            {
              path: 'products/p1/cover.webp',
              alt: 'c',
              width: 1,
              height: 1,
              blurhash: null,
              order: 0,
            },
          ],
        }),
      ),
    ]);

    await finalizeProductMedia(ctxWith(db), SYSTEM, 'p1', 'products/p1/cover.webp', {
      path: 'products/p1/cover.webp',
      width: 1_200,
      height: 800,
      blurhash: 'LKO2',
    });

    const media = store.get('products/p1')?.media as {
      width: number;
      height: number;
      blurhash: string | null;
    }[];
    expect(media[0]).toMatchObject({ width: 1_200, height: 800, blurhash: 'LKO2' });
  });

  it('throws ProductNotFoundError when the product is gone', async () => {
    const { db } = fakeDb();
    await expect(
      finalizeProductMedia(ctxWith(db), SYSTEM, 'ghost', 'products/ghost/x.webp', null),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it('removes a quarantined entry', async () => {
    const { db, store } = fakeDb([
      storedProduct(
        'products/p1',
        draftDoc({
          media: [
            {
              path: 'products/p1/good.webp',
              alt: 'ok',
              width: 10,
              height: 10,
              blurhash: null,
              order: 0,
            },
            {
              path: 'products/p1/bad.webp',
              alt: 'bad',
              width: 1,
              height: 1,
              blurhash: null,
              order: 1,
            },
          ],
        }),
      ),
    ]);

    await finalizeProductMedia(ctxWith(db), SYSTEM, 'p1', 'products/p1/bad.webp', null);

    const media = store.get('products/p1')?.media as { path: string }[];
    expect(media).toHaveLength(1);
    expect(media.some((item) => item.path === 'products/p1/bad.webp')).toBe(false);
  });
});
