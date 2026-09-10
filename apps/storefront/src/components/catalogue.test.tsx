import { render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { aSummary } from '@/test-support/product';

import { EmptyState } from './EmptyState';
import { Pagination } from './Pagination';
import { ProductCard } from './ProductCard';
import { ProductGrid, ProductGridSkeleton } from './ProductGrid';
import { ProductRail } from './ProductRail';

async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  if (results.violations.length > 0) {
    expect.fail(
      results.violations.map((violation) => `${violation.id}: ${violation.help}`).join('\n'),
    );
  }
}

describe('ProductCard', () => {
  beforeEach(() => {
    // A media base has to be set, or `mediaUrl` returns null and the card renders its
    // placeholder — which is a real state, but not the one these image tests are about.
    vi.stubEnv('NEXT_PUBLIC_MEDIA_BASE_URL', 'https://cdn.example.test');
  });

  it('is one link covering the whole card', () => {
    // On a phone, a link that is only the title leaves most of the card doing nothing.
    render(<ProductCard product={aSummary()} />);
    const link = screen.getByRole('link');

    expect(link).toHaveAttribute('href', '/p/wooden-blocks');
    expect(
      within(link).getByRole('heading', { name: 'Wooden building blocks' }),
    ).toBeInTheDocument();
  });

  it('shows the price', () => {
    render(<ProductCard product={aSummary()} />);

    // ₹1,299.00 for the seeded paise value, formatted for the store locale.
    expect(screen.getByText(/1,299/u)).toBeInTheDocument();
  });

  it('strikes through the MRP only when there is a discount', () => {
    const { rerender } = render(<ProductCard product={aSummary()} />);
    expect(screen.getByText(/1,499/u)).toBeInTheDocument();

    rerender(
      <ProductCard
        product={aSummary({ mrpFromMinor: 129_900 as ReturnType<typeof aSummary>['mrpFromMinor'] })}
      />,
    );
    expect(screen.queryByText(/1,499/u)).not.toBeInTheDocument();
  });

  it('uses the cover image with its alt text', () => {
    render(<ProductCard product={aSummary()} />);
    const image = screen.getByRole('img', { name: 'A tower of beechwood blocks' });

    expect(image).toHaveAttribute(
      'src',
      'https://cdn.example.test/products/wooden-blocks/cover.webp',
    );
  });

  it('renders a placeholder, not a broken image, when there is no photography', () => {
    // The state of every product on a freshly seeded store.
    render(<ProductCard product={aSummary({ cover: null })} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('marks the image as priority only when told to', () => {
    // The LCP row is preloaded; the rest lazy-load. Priority on everything defeats itself.
    const { rerender } = render(<ProductCard product={aSummary()} priority />);
    expect(screen.getByRole('img')).toHaveAttribute('data-priority', 'true');

    rerender(<ProductCard product={aSummary()} />);
    expect(screen.getByRole('img')).not.toHaveAttribute('data-priority');
  });

  it('states out-of-stock in words, not only a colour', () => {
    render(<ProductCard product={aSummary({ inStock: false })} />);

    expect(screen.getByText('Out of stock')).toBeInTheDocument();
  });

  it('says nothing about stock for an in-stock product', () => {
    render(<ProductCard product={aSummary({ inStock: true })} />);

    expect(screen.queryByText('Out of stock')).not.toBeInTheDocument();
  });

  it('shows the badge when present', () => {
    render(<ProductCard product={aSummary({ badge: 'Bestseller' })} />);

    expect(screen.getByText('Bestseller')).toBeInTheDocument();
  });

  it('is accessible', async () => {
    const { container } = render(<ProductCard product={aSummary()} />);

    await expectNoAxeViolations(container);
  });
});

describe('ProductGrid', () => {
  const products = [
    aSummary({
      id: 'a' as ReturnType<typeof aSummary>['id'],
      slug: 'a' as ReturnType<typeof aSummary>['slug'],
    }),
    aSummary({
      id: 'b' as ReturnType<typeof aSummary>['id'],
      slug: 'b' as ReturnType<typeof aSummary>['slug'],
    }),
    aSummary({
      id: 'c' as ReturnType<typeof aSummary>['id'],
      slug: 'c' as ReturnType<typeof aSummary>['slug'],
    }),
  ];

  it('renders one card per product', () => {
    render(<ProductGrid products={products} />);

    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('marks only the leading row as priority', () => {
    vi.stubEnv('NEXT_PUBLIC_MEDIA_BASE_URL', 'https://cdn.example.test');
    render(<ProductGrid products={products} priorityCount={1} />);

    const prioritised = screen
      .getAllByRole('img')
      .filter((image) => image.dataset.priority === 'true');
    expect(prioritised).toHaveLength(1);
  });

  it('renders an empty grid without error', () => {
    render(<ProductGrid products={[]} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('ProductGridSkeleton', () => {
  it('is hidden from assistive tech', () => {
    // A screen reader should hear the region's busy state, not a description of grey boxes.
    const { container } = render(<ProductGridSkeleton count={4} />);

    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });
});

describe('ProductRail', () => {
  it('renders nothing when empty, rather than a lone heading', () => {
    // "Featured" over a blank space reads as broken; a fresh store has empty categories.
    const { container } = render(<ProductRail title="Featured" products={[]} headingId="h" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders a heading and a card per product', () => {
    render(
      <ProductRail
        title="Featured"
        products={[aSummary()]}
        headingId="featured"
        seeAllHref="/c/all"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Featured' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all' })).toHaveAttribute('href', '/c/all');
  });

  it('omits the see-all link when there is no target', () => {
    render(<ProductRail title="Featured" products={[aSummary()]} headingId="featured" />);

    expect(screen.queryByRole('link', { name: 'See all' })).not.toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('renders the passed copy, not any of its own', () => {
    render(<EmptyState title="Nothing matched" body="Try a broader age range." />);

    expect(screen.getByRole('heading', { name: 'Nothing matched' })).toBeInTheDocument();
    expect(screen.getByText('Try a broader age range.')).toBeInTheDocument();
  });
});

describe('Pagination', () => {
  const base = new URLSearchParams({ sort: 'price_asc' });

  it('renders nothing on a single first page', () => {
    const { container } = render(
      <Pagination basePath="/c/wooden" params={base} nextCursor={null} hasCursor={false} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('offers a next link that preserves the current params and adds the cursor', () => {
    render(<Pagination basePath="/c/wooden" params={base} nextCursor="CURSOR" hasCursor={false} />);
    const next = screen.getByRole('link', { name: 'Next page' });

    expect(next).toHaveAttribute('href', expect.stringContaining('sort=price_asc'));
    expect(next).toHaveAttribute('href', expect.stringContaining('cursor=CURSOR'));
  });

  it('offers a way back to the first page once past it', () => {
    render(<Pagination basePath="/c/wooden" params={base} nextCursor={null} hasCursor />);
    const back = screen.getByRole('link', { name: 'Back to start' });

    // No cursor on the first-page link.
    expect(back).toHaveAttribute('href', expect.not.stringContaining('cursor'));
  });

  it('is a labelled navigation landmark', () => {
    render(<Pagination basePath="/c/wooden" params={base} nextCursor="C" hasCursor />);

    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
  });
});
