import { describe, expect, it, vi } from 'vitest';

import { asSystem, createStoreContext, systemClock } from '@romp/data';
import type * as DataModule from '@romp/data';
import { createSilentLogger } from '@romp/observability';

import type { MediaFinalizeDeps } from './finalize';
import { finalizeMediaObject, parseProductMediaPath } from './finalize';

/**
 * The media-finalize orchestration, with Storage and Firestore injected.
 *
 * The pure sniff decision is `@romp/core`'s; this asserts the orchestration around it — that
 * an accepted image writes dimensions to the product, that a quarantined one both drops the
 * media entry and deletes the object, and that the ordering (drop entry, then delete) holds.
 * The `finalizeProductMedia` write is mocked so the branching is tested without an emulator;
 * the write itself is emulator-tested in `infra/tests/catalogue-write.test.ts`.
 */

const finalizeProductMedia = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('@romp/data', async (importOriginal) => {
  const actual = await importOriginal<typeof DataModule>();
  return { ...actual, finalizeProductMedia };
});

const SYSTEM = asSystem('media finalize');
const LOGGER = createSilentLogger();

function ctx(): DataModule.StoreContext {
  return createStoreContext({ storeId: 'test-store', db: {} as never, clock: systemClock });
}

/** A PNG header declaring 800×600. */
function png(): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  bytes.set([0, 0, 0x03, 0x20], 16); // 800
  bytes.set([0, 0, 0x02, 0x58], 20); // 600
  return bytes;
}

function deps(overrides: Partial<MediaFinalizeDeps> = {}): MediaFinalizeDeps {
  return {
    readObjectHead: () => Promise.resolve(png()),
    declaredContentType: () => Promise.resolve('image/png'),
    deleteObject: vi.fn(() => Promise.resolve()),
    readDimensions: () => ({ width: 800, height: 600 }),
    ...overrides,
  };
}

describe('parseProductMediaPath', () => {
  it('parses a product media path', () => {
    expect(parseProductMediaPath('products/abc/cover.webp')).toEqual({
      productId: 'abc',
      fileName: 'cover.webp',
    });
  });

  it('rejects a non-product path', () => {
    expect(parseProductMediaPath('store-assets/logo.svg')).toBeNull();
    expect(parseProductMediaPath('payment-proofs/o1/u1/proof.png')).toBeNull();
    expect(parseProductMediaPath('products/abc')).toBeNull();
    expect(parseProductMediaPath('products//cover.webp')).toBeNull();
  });
});

describe('finalizeMediaObject', () => {
  it('accepts a byte-confirmed image and writes its dimensions', async () => {
    finalizeProductMedia.mockClear();
    const outcome = await finalizeMediaObject(
      ctx(),
      SYSTEM,
      deps(),
      { productId: 'p1', objectPath: 'products/p1/cover.png' },
      LOGGER,
    );

    expect(outcome).toBe('accepted');
    expect(finalizeProductMedia).toHaveBeenCalledWith(
      expect.anything(),
      SYSTEM,
      'p1',
      'products/p1/cover.png',
      {
        path: 'products/p1/cover.png',
        width: 800,
        height: 600,
        blurhash: null,
      },
    );
  });

  it('keeps the placeholder dimensions when they cannot be read', async () => {
    finalizeProductMedia.mockClear();
    await finalizeMediaObject(
      ctx(),
      SYSTEM,
      deps({ readDimensions: () => null }),
      { productId: 'p1', objectPath: 'products/p1/cover.png' },
      LOGGER,
    );

    expect(finalizeProductMedia).toHaveBeenCalledWith(
      expect.anything(),
      SYSTEM,
      'p1',
      'products/p1/cover.png',
      {
        path: 'products/p1/cover.png',
        width: 1,
        height: 1,
        blurhash: null,
      },
    );
  });

  it('quarantines a file whose bytes are not an allowed image, dropping the entry and deleting the object', async () => {
    finalizeProductMedia.mockClear();
    const deleteObject = vi.fn(() => Promise.resolve());
    const svg = new TextEncoder().encode('<svg><script>alert(1)</script></svg>');

    const outcome = await finalizeMediaObject(
      ctx(),
      SYSTEM,
      deps({ readObjectHead: () => Promise.resolve(svg), deleteObject }),
      { productId: 'p1', objectPath: 'products/p1/evil.png' },
      LOGGER,
    );

    expect(outcome).toBe('quarantined');
    // The entry is dropped (null update) and the object deleted.
    expect(finalizeProductMedia).toHaveBeenCalledWith(
      expect.anything(),
      SYSTEM,
      'p1',
      'products/p1/evil.png',
      null,
    );
    expect(deleteObject).toHaveBeenCalledWith('products/p1/evil.png');
  });

  it('quarantines a real image whose bytes differ from the declared type', async () => {
    finalizeProductMedia.mockClear();
    const outcome = await finalizeMediaObject(
      ctx(),
      SYSTEM,
      // PNG bytes, but the metadata claimed JPEG.
      deps({ declaredContentType: () => Promise.resolve('image/jpeg') }),
      { productId: 'p1', objectPath: 'products/p1/x.jpg' },
      LOGGER,
    );

    expect(outcome).toBe('quarantined');
    expect(finalizeProductMedia).toHaveBeenCalledWith(
      expect.anything(),
      SYSTEM,
      'p1',
      'products/p1/x.jpg',
      null,
    );
  });

  it('does not fail the finalize when the quarantine object-delete fails', async () => {
    finalizeProductMedia.mockClear();
    const svg = new TextEncoder().encode('<svg></svg>');
    const outcome = await finalizeMediaObject(
      ctx(),
      SYSTEM,
      deps({
        readObjectHead: () => Promise.resolve(svg),
        deleteObject: () => Promise.reject(new Error('storage down')),
      }),
      { productId: 'p1', objectPath: 'products/p1/evil.png' },
      LOGGER,
    );

    // The entry is already gone from the product, so a stray file is logged, not fatal.
    expect(outcome).toBe('quarantined');
  });
});
