import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CategoryDoc, ProductDoc } from '@romp/contracts';
import { aCategory, aProduct } from '@romp/contracts/fixtures';
import { createMemorySearchPort } from '@romp/data';
import type { WithId } from '@romp/data';

/**
 * The home page's data rails, rendered against the in-memory adapter.
 *
 * Async server components, so each is called to resolve its element and that element is
 * rendered. `getNavCategories` reads the `categories` collection through a repository
 * rather than the search port, so it is mocked; the featured and category rails run
 * through the real search port over a known catalogue.
 */
vi.mock('@/server/firebase', () => ({
  catalogueAvailable: () => true,
  db: () => ({}) as never,
  storeId: () => 'test-store',
}));

const navCategories = vi.fn<() => Promise<readonly WithId<CategoryDoc>[]>>();

vi.mock('@/server/catalogue', async (importOriginal) => ({
  ...(await importOriginal<typeof CatalogueModule>()),
  getNavCategories: () => navCategories(),
}));

import type * as CatalogueModule from '@/server/catalogue';

const withId = (id: string, overrides: Partial<ProductDoc> = {}): WithId<ProductDoc> => ({
  ...aProduct(),
  id,
  ...overrides,
});

const category = (slug: string, name: string): WithId<CategoryDoc> => ({
  ...aCategory(),
  id: slug,
  slug: slug as CategoryDoc['slug'],
  name,
});

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_MEDIA_BASE_URL', 'https://cdn.example.test');
  globalThis.__ROMP_TEST_SEARCH_PORT = createMemorySearchPort({
    products: [
      withId('woo', {
        slug: 'woo' as ProductDoc['slug'],
        name: 'Wooden thing',
        categorySlug: 'wooden' as ProductDoc['categorySlug'],
        publishedAt: new Date('2026-03-01'),
      }),
      withId('puz', {
        slug: 'puz' as ProductDoc['slug'],
        name: 'Puzzle thing',
        categorySlug: 'puzzles' as ProductDoc['categorySlug'],
        publishedAt: new Date('2026-02-01'),
      }),
    ],
  });
  navCategories.mockReset();
});

afterEach(() => {
  globalThis.__ROMP_TEST_SEARCH_PORT = undefined;
});

describe('FeaturedRail', () => {
  it('renders the newest products under the configured title', async () => {
    const { FeaturedRail } = await import('./HomeRails');
    render(await FeaturedRail({ title: 'This season' }));

    expect(screen.getByRole('heading', { name: 'This season' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Wooden thing/u })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all' })).toHaveAttribute('href', '/c/all');
  });
});

describe('NavCategoryRails', () => {
  it('renders a rail per nav category that has products', async () => {
    navCategories.mockResolvedValue([
      category('wooden', 'Wooden toys'),
      category('puzzles', 'Puzzles'),
    ]);

    const { NavCategoryRails } = await import('./HomeRails');
    render(await NavCategoryRails());

    expect(screen.getByRole('heading', { name: 'Wooden toys' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Puzzles' })).toBeInTheDocument();
    // One "See all" per rail, each pointing at its own category listing.
    const seeAll = screen.getAllByRole('link', { name: 'See all' });
    expect(seeAll.map((link) => link.getAttribute('href'))).toEqual(['/c/wooden', '/c/puzzles']);
  });

  it('omits a category with no products, rather than a bare heading', async () => {
    // A store mid-setup has empty categories; a rail with an empty heading reads as broken.
    navCategories.mockResolvedValue([
      category('wooden', 'Wooden toys'),
      category('outdoor', 'Outdoor'),
    ]);

    const { NavCategoryRails } = await import('./HomeRails');
    render(await NavCategoryRails());

    expect(screen.getByRole('heading', { name: 'Wooden toys' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Outdoor' })).not.toBeInTheDocument();
  });

  it('renders nothing when there are no nav categories', async () => {
    navCategories.mockResolvedValue([]);

    const { NavCategoryRails } = await import('./HomeRails');
    const { container } = render(await NavCategoryRails());

    expect(container.querySelectorAll('h2')).toHaveLength(0);
  });
});
