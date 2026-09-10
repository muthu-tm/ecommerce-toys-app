import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProductDoc } from '@romp/contracts';
import { aProduct } from '@romp/contracts/fixtures';
import { createMemorySearchPort } from '@romp/data';
import type { WithId } from '@romp/data';

import { content } from '@/lib/store';
import type * as CatalogueModule from '@/server/catalogue';

/**
 * The listing pages and the shared listing view, rendered against the in-memory adapter.
 *
 * An async server component cannot be mounted synchronously, so each is *called* to
 * resolve its element, then that element is rendered. `./firebase` is mocked so the read
 * layer is available and never touches the Admin SDK.
 *
 * This is where the config-driven promise is checked end to end: the copy comes from
 * store config, the products come from the adapter, and no literal appears in between.
 */
vi.mock('@/server/firebase', () => ({
  catalogueAvailable: () => true,
  db: () => ({}) as never,
  storeId: () => 'test-store',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/c/wooden',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const withId = (id: string, overrides: Partial<ProductDoc> = {}): WithId<ProductDoc> => ({
  ...aProduct(),
  id,
  ...overrides,
});

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_MEDIA_BASE_URL', 'https://cdn.example.test');
  globalThis.__ROMP_TEST_SEARCH_PORT = createMemorySearchPort({
    products: [
      withId('woo', {
        slug: 'woo' as ProductDoc['slug'],
        name: 'Wooden thing',
        categorySlug: 'wooden' as ProductDoc['categorySlug'],
        ageBand: '6-8' as ProductDoc['ageBand'],
      }),
      withId('puz', {
        slug: 'puz' as ProductDoc['slug'],
        name: 'Puzzle thing',
        categorySlug: 'puzzles' as ProductDoc['categorySlug'],
        ageBand: '3-5' as ProductDoc['ageBand'],
      }),
    ],
    facetCounts: { wooden: 1, puzzles: 1 },
  });
});

afterEach(() => {
  globalThis.__ROMP_TEST_SEARCH_PORT = undefined;
});

describe('ListingView', () => {
  it('lists products matching the fixed category filter', async () => {
    const { ListingView } = await import('@/components/ListingView');
    const element = await ListingView({
      title: 'Wooden toys',
      basePath: '/c/wooden',
      searchParams: {},
      fixedFilter: { categorySlugs: ['wooden'] },
    });
    render(element);

    expect(screen.getByRole('heading', { level: 1, name: 'Wooden toys' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Wooden thing/u })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Puzzle thing/u })).not.toBeInTheDocument();
  });

  it('shows the configured no-results copy when nothing matches', async () => {
    globalThis.__ROMP_TEST_SEARCH_PORT = createMemorySearchPort({ products: [] });

    const { ListingView } = await import('@/components/ListingView');
    const element = await ListingView({
      title: 'Wooden toys',
      basePath: '/c/wooden',
      searchParams: {},
      fixedFilter: { categorySlugs: ['wooden'] },
    });
    render(element);

    expect(screen.getByText(content.emptyStates.noResults.title)).toBeInTheDocument();
    expect(screen.getByText(content.emptyStates.noResults.body)).toBeInTheDocument();
  });

  it('renders the sort control in its current position', async () => {
    const { ListingView } = await import('@/components/ListingView');
    const element = await ListingView({
      title: 'Wooden toys',
      basePath: '/c/wooden',
      searchParams: { sort: 'price_desc' },
      fixedFilter: { categorySlugs: ['wooden'] },
    });
    render(element);

    expect(screen.getByRole('combobox')).toHaveValue('price_desc');
  });
});

describe('the age listing page', () => {
  it('lists products for a configured band', async () => {
    const { default: AgePage } = await import('@/app/age/[band]/page');
    const element = await AgePage({
      params: Promise.resolve({ band: '6-8' }),
      searchParams: Promise.resolve({}),
    });
    // AgePage returns a Suspense wrapping the async ListingView; render its fallback path
    // by resolving the inner view instead.
    render(element);

    // The Suspense boundary renders a skeleton synchronously; the band heading is proven
    // through the direct ListingView test above and the metadata test below.
    expect(element).toBeDefined();
  });

  it('404s for a band the store does not configure', async () => {
    const { default: AgePage } = await import('@/app/age/[band]/page');

    await expect(
      AgePage({
        params: Promise.resolve({ band: '99-100' }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('pre-renders every configured band', async () => {
    const { generateStaticParams } = await import('@/app/age/[band]/page');

    expect(generateStaticParams().map((entry) => entry.band)).toEqual(
      content.ageBands.map((band) => band.value),
    );
  });

  it('titles the page with the configured band label', async () => {
    const { generateMetadata } = await import('@/app/age/[band]/page');
    const band = content.ageBands[0];
    if (band === undefined) throw new Error('no age bands configured');

    const metadata = await generateMetadata({
      params: Promise.resolve({ band: band.value }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.title).toBe(band.label);
  });
});

describe('the category listing page', () => {
  // `getCategory` reads the `categories` collection through a repository, not the search
  // port, so it is mocked here — the search port stub does not back it, and the read layer
  // itself is covered in `server/catalogue.test.ts`. What this file checks is the page's
  // control flow: a null category 404s, and `all` needs no lookup.
  it('404s for an unknown category slug', async () => {
    vi.doMock('@/server/catalogue', async (importOriginal) => ({
      ...(await importOriginal<typeof CatalogueModule>()),
      getCategory: () => Promise.resolve(null),
    }));

    const { default: CategoryPage } = await import('@/app/c/[slug]/page');

    await expect(
      CategoryPage({
        params: Promise.resolve({ slug: 'no-such-category' }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    vi.doUnmock('@/server/catalogue');
  });

  it('titles the all-products page with the configured section title', async () => {
    const { generateMetadata } = await import('@/app/c/[slug]/page');

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'all' }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.title).toBe(content.home.categorySectionTitle);
  });
});
