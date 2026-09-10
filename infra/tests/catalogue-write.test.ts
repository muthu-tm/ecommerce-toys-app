import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { money } from '@romp/contracts';
import type { ProductDoc, VariantDoc } from '@romp/contracts';
import { aProduct, aVariant } from '@romp/contracts/fixtures';
import {
  asOperator,
  asSystem,
  ANONYMOUS,
  converters,
  createProduct,
  createStoreContext,
  createVariant,
  finalizeProductMedia,
  getDocument,
  setProductStatus,
  systemClock,
  updateVariant,
} from '@romp/data';
import type { StoreContext } from '@romp/data';

import { DEMO_PROJECT_ID } from './helpers/emulator';

/**
 * The catalogue write path against real Firestore.
 *
 * `@romp/core` unit-tests the pure decisions (summary, transitions, media order); this
 * proves the transactional guarantees that only a real database shows: a variant write
 * refreshes the product summary atomically, a status change respects the machine, and the
 * media finalize fills or quarantines an entry. Staff-only enforcement is asserted here too,
 * because the Admin SDK bypasses rules and this filter is the only control.
 */

let app: App;
let ctx: StoreContext;
const STAFF = asOperator('staff-1', 'staff');
const SYSTEM = asSystem('media finalize');

beforeAll(() => {
  app = initializeApp({ projectId: DEMO_PROJECT_ID }, `catalogue-write-${String(Date.now())}`);
  ctx = createStoreContext({ storeId: 'test-store', db: getFirestore(app), clock: systemClock });
});

afterAll(async () => {
  await deleteApp(app);
});

/** A draft product with no variants and an empty summary — the shape create produces. */
function draftProduct(): ProductDoc {
  return aProduct({
    status: 'draft',
    variantSummary: [],
    priceFromMinor: money(0),
    mrpFromMinor: money(0),
    publishedAt: null,
    media: [],
    seo: { title: null, description: null, index: false },
  });
}

function activeVariant(overrides: Partial<VariantDoc> = {}): VariantDoc {
  return aVariant({
    priceMinor: money(2_00_000),
    mrpMinor: money(2_50_000),
    active: true,
    ...overrides,
  });
}

describe('createProduct', () => {
  it('writes a draft and returns its id, readable back through the converter', async () => {
    const { id } = await createProduct(ctx, STAFF, draftProduct());

    const readBack = await getDocument(ctx, `products/${id}`, converters.products);
    expect(readBack?.status).toBe('draft');
    expect(readBack?.variantSummary).toEqual([]);
  });

  it('refuses a non-staff caller', async () => {
    await expect(createProduct(ctx, ANONYMOUS, draftProduct())).rejects.toThrow();
  });
});

describe('variant writes refresh the product summary in one transaction', () => {
  it('a new variant moves the product from-price and populates the summary', async () => {
    const { id } = await createProduct(ctx, STAFF, draftProduct());

    await createVariant(ctx, STAFF, id, activeVariant({ priceMinor: money(2_00_000) }));
    await createVariant(ctx, STAFF, id, activeVariant({ priceMinor: money(1_00_000) }));

    const product = await getDocument(ctx, `products/${id}`, converters.products);
    expect(product?.variantSummary).toHaveLength(2);
    // The from-price is the minimum across active variants.
    expect(product?.priceFromMinor).toBe(1_00_000);
  });

  it('updating a variant price re-derives the from-price atomically', async () => {
    const { id } = await createProduct(ctx, STAFF, draftProduct());
    const { id: variantId } = await createVariant(ctx, STAFF, id, activeVariant());

    await updateVariant(ctx, STAFF, id, variantId, {
      name: 'Natural',
      sku: activeVariant().sku,
      priceMinor: money(75_000),
      mrpMinor: money(90_000),
      options: {},
      active: true,
      weightGrams: 500,
    });

    const product = await getDocument(ctx, `products/${id}`, converters.products);
    expect(product?.priceFromMinor).toBe(75_000);
  });
});

describe('setProductStatus', () => {
  it('refuses to publish a product with no active variant', async () => {
    const { id } = await createProduct(ctx, STAFF, draftProduct());

    await expect(setProductStatus(ctx, STAFF, id, 'active')).rejects.toThrow();
  });

  it('publishes once a product has an active variant, stamping publishedAt and index', async () => {
    const { id } = await createProduct(ctx, STAFF, draftProduct());
    await createVariant(ctx, STAFF, id, activeVariant());

    await setProductStatus(ctx, STAFF, id, 'active');

    const product = await getDocument(ctx, `products/${id}`, converters.products);
    expect(product?.status).toBe('active');
    expect(product?.publishedAt).not.toBeNull();
    expect(product?.seo.index).toBe(true);
  });

  it('rejects the illegal archived -> active transition', async () => {
    const { id } = await createProduct(ctx, STAFF, draftProduct());
    await createVariant(ctx, STAFF, id, activeVariant());
    await setProductStatus(ctx, STAFF, id, 'active');
    await setProductStatus(ctx, STAFF, id, 'archived');

    await expect(setProductStatus(ctx, STAFF, id, 'active')).rejects.toThrow();
  });
});

describe('finalizeProductMedia', () => {
  it('fills width/height/blurhash on the matching media entry', async () => {
    const path = 'products/finalize/cover.webp';
    const { id } = await createProduct(
      ctx,
      STAFF,
      aProduct({
        status: 'draft',
        variantSummary: [],
        priceFromMinor: money(0),
        mrpFromMinor: money(0),
        publishedAt: null,
        seo: { title: null, description: null, index: false },
        media: [{ path, alt: 'A toy', width: 1, height: 1, blurhash: null, order: 0 }],
      }),
    );

    await finalizeProductMedia(ctx, SYSTEM, id, path, {
      path,
      width: 1_200,
      height: 900,
      blurhash: 'LKO2?U%2Tw=w',
    });

    const product = await getDocument(ctx, `products/${id}`, converters.products);
    expect(product?.media[0]).toMatchObject({
      width: 1_200,
      height: 900,
      blurhash: 'LKO2?U%2Tw=w',
    });
  });

  it('removes a quarantined entry so a rejected upload never renders', async () => {
    const path = 'products/quarantine/bad.webp';
    const { id } = await createProduct(
      ctx,
      STAFF,
      aProduct({
        status: 'draft',
        variantSummary: [],
        priceFromMinor: money(0),
        mrpFromMinor: money(0),
        publishedAt: null,
        seo: { title: null, description: null, index: false },
        media: [
          {
            path: 'products/quarantine/good.webp',
            alt: 'Good',
            width: 10,
            height: 10,
            blurhash: null,
            order: 0,
          },
          { path, alt: 'Bad', width: 1, height: 1, blurhash: null, order: 1 },
        ],
      }),
    );

    await finalizeProductMedia(ctx, SYSTEM, id, path, null);

    const product = await getDocument(ctx, `products/${id}`, converters.products);
    expect(product?.media).toHaveLength(1);
    expect(product?.media.some((item) => item.path === path)).toBe(false);
  });
});
