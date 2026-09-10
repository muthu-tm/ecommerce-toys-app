import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CategoryDoc, ProductDoc } from '@romp/contracts';
import { aCategory, aProduct } from '@romp/contracts/fixtures';
import type { WithId } from '@romp/data';

import { aVariant } from '@/test-support/variant';

/**
 * The product detail page, rendered as an async server component: it is *called* to
 * resolve its element, then that element is rendered. The read layer (`@/server/catalogue`)
 * is mocked at the module boundary rather than backed by the in-memory adapter, because
 * `getProduct` reads a single document through a repository, not the search port — the
 * same reason the category page test mocks `getCategory`.
 */

let productResult: {
  product: WithId<ProductDoc>;
  variants: readonly ReturnType<typeof aVariant>[];
} | null = null;
let categoryResult: WithId<CategoryDoc> | null = null;

vi.mock('@/server/catalogue', () => ({
  getProduct: () => Promise.resolve(productResult),
  getCategory: () => Promise.resolve(categoryResult),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// The buy box's add-to-cart button is a client island that talks to the cart API; the page
// test only cares that the page composes, so the client is stubbed.
vi.mock('@/lib/cart-api', () => ({
  cartApi: { add: vi.fn(() => Promise.resolve()) },
  CartApiError: class CartApiError extends Error {},
}));

const withId = (overrides: Partial<ProductDoc> = {}): WithId<ProductDoc> => ({
  ...aProduct(overrides),
  id: 'wooden-blocks',
});

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_MEDIA_BASE_URL', 'https://cdn.example.test');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://shop.example.test');
  productResult = { product: withId(), variants: [aVariant()] };
  categoryResult = { ...aCategory(), id: 'building-sets' };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the product page', () => {
  it('renders the product with a JSON-LD script', async () => {
    const { default: ProductPage } = await import('@/app/p/[slug]/page');
    const element = await ProductPage({ params: Promise.resolve({ slug: 'wooden-blocks' }) });
    const { container } = render(element);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Wooden building blocks' }),
    ).toBeInTheDocument();

    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    const parsed = JSON.parse(script?.textContent ?? '{}') as {
      '@type': string;
      offers: { url: string };
    };
    expect(parsed['@type']).toBe('Product');
    expect(parsed.offers.url).toBe('https://shop.example.test/p/wooden-blocks');
  });

  it('404s for a missing product', async () => {
    productResult = null;
    const { default: ProductPage } = await import('@/app/p/[slug]/page');

    await expect(
      ProductPage({ params: Promise.resolve({ slug: 'no-such-product' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('falls back to the category slug when the category lookup is null', async () => {
    categoryResult = null;
    const { default: ProductPage } = await import('@/app/p/[slug]/page');
    const element = await ProductPage({ params: Promise.resolve({ slug: 'wooden-blocks' }) });
    render(element);

    // The breadcrumb links the category by slug even when its document is gone.
    expect(screen.getByRole('link', { name: 'building-sets' })).toHaveAttribute(
      'href',
      '/c/building-sets',
    );
  });
});

describe('the product page metadata', () => {
  it('sets a canonical URL and indexes by default', async () => {
    const { generateMetadata } = await import('@/app/p/[slug]/page');
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'wooden-blocks' }),
    });

    expect(metadata.alternates?.canonical).toBe('https://shop.example.test/p/wooden-blocks');
    expect(metadata.robots).toMatchObject({ index: true });
    expect(metadata.title).toBe('Wooden building blocks');
  });

  it('honours a per-product noindex from SEO config', async () => {
    productResult = {
      product: withId({ seo: { title: null, description: null, index: false } }),
      variants: [aVariant()],
    };
    const { generateMetadata } = await import('@/app/p/[slug]/page');
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'wooden-blocks' }),
    });

    expect(metadata.robots).toMatchObject({ index: false });
  });

  it('uses the SEO title override when present', async () => {
    productResult = {
      product: withId({ seo: { title: 'Custom title', description: 'Custom desc', index: true } }),
      variants: [aVariant()],
    };
    const { generateMetadata } = await import('@/app/p/[slug]/page');
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'wooden-blocks' }),
    });

    expect(metadata.title).toBe('Custom title');
    expect(metadata.description).toBe('Custom desc');
  });

  it('noindexes a missing product', async () => {
    productResult = null;
    const { generateMetadata } = await import('@/app/p/[slug]/page');
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'gone' }),
    });

    expect(metadata.robots).toMatchObject({ index: false });
  });
});
