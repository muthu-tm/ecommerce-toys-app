import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProductDoc } from '@romp/contracts';
import { aProduct } from '@romp/contracts/fixtures';

import { content } from '@/lib/store';
import { aVariant } from '@/test-support/variant';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/cart-api', () => ({
  cartApi: { add: vi.fn(() => Promise.resolve()) },
  CartApiError: class CartApiError extends Error {},
}));

import { Breadcrumbs } from './Breadcrumbs';
import { ProductDetail } from './ProductDetail';
import { ProductGallery } from './ProductGallery';
import { VariantSelector } from './VariantSelector';

async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  if (results.violations.length > 0) {
    expect.fail(
      results.violations.map((violation) => `${violation.id}: ${violation.help}`).join('\n'),
    );
  }
}

const moneyFormat = { locale: 'en-IN', currency: 'INR' } as const;

const labels = {
  selectVariant: content.product.selectVariant,
  addToCart: content.product.addToCart,
  outOfStock: content.product.outOfStock,
};

describe('Breadcrumbs', () => {
  it('is a labelled nav with the current page marked and not linked', () => {
    render(
      <Breadcrumbs
        label="Home"
        items={[
          { label: 'Home', href: '/' },
          { label: 'Wooden toys', href: '/c/wooden' },
          { label: 'Wooden blocks' },
        ]}
      />,
    );

    const nav = screen.getByRole('navigation', { name: 'Home' });
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(within(nav).getByRole('link', { name: 'Wooden toys' })).toHaveAttribute(
      'href',
      '/c/wooden',
    );
    // The last crumb is the current page: text with aria-current, never a link.
    const current = screen.getByText('Wooden blocks');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(within(nav).queryByRole('link', { name: 'Wooden blocks' })).not.toBeInTheDocument();
  });
});

describe('VariantSelector', () => {
  it('shows the selected variant price and a discount strike', () => {
    render(
      <VariantSelector
        productId="p1"
        variants={[aVariant()]}
        labels={labels}
        moneyFormat={moneyFormat}
      />,
    );

    expect(screen.getByText(/1,299/u)).toBeInTheDocument();
    expect(screen.getByText(/1,499/u)).toBeInTheDocument();
  });

  it('offers only active variants and switches price on selection', async () => {
    const user = userEvent.setup();
    render(
      <VariantSelector
        productId="p1"
        variants={[
          aVariant({ id: 'a' as ReturnType<typeof aVariant>['id'], name: 'Small' }),
          aVariant({
            id: 'b' as ReturnType<typeof aVariant>['id'],
            name: 'Large',
            priceMinor: 199_900 as ReturnType<typeof aVariant>['priceMinor'],
            mrpMinor: 199_900 as ReturnType<typeof aVariant>['mrpMinor'],
          }),
          aVariant({
            id: 'c' as ReturnType<typeof aVariant>['id'],
            name: 'Retired',
            active: false,
          }),
        ]}
        labels={labels}
        moneyFormat={moneyFormat}
      />,
    );

    // The inactive variant is not offered.
    expect(screen.queryByText('Retired')).not.toBeInTheDocument();

    // Selecting "Large" swaps the displayed price.
    await user.click(screen.getByText('Large'));
    expect(screen.getByText(/1,999/u)).toBeInTheDocument();
  });

  it('disables add-to-cart and says so in words when out of stock', () => {
    render(
      <VariantSelector
        productId="p1"
        variants={[aVariant({ inStock: false })]}
        labels={labels}
        moneyFormat={moneyFormat}
      />,
    );

    expect(screen.getByRole('button', { name: labels.addToCart })).toBeDisabled();
    // Availability is a word, not only a colour.
    expect(screen.getAllByText(labels.outOfStock).length).toBeGreaterThan(0);
  });

  it('exposes a live add-to-cart button when in stock', () => {
    render(
      <VariantSelector
        productId="p1"
        variants={[aVariant()]}
        labels={labels}
        moneyFormat={moneyFormat}
      />,
    );

    expect(screen.getByRole('button', { name: labels.addToCart })).toBeEnabled();
  });

  it('never renders an exact stock count', () => {
    const { container } = render(
      <VariantSelector
        productId="p1"
        variants={[aVariant()]}
        labels={labels}
        moneyFormat={moneyFormat}
      />,
    );

    // Availability is a boolean surfaced as words; no digit-based stock number leaks.
    expect(container.textContent ?? '').not.toMatch(/\d+\s*(left|in stock|units)/iu);
  });
});

describe('ProductGallery', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_MEDIA_BASE_URL', 'https://cdn.example.test');
  });

  it('renders a placeholder and no thumbnails when there are no images', () => {
    render(<ProductGallery images={[]} productName="Wooden blocks" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('lets a thumbnail switch the main image', async () => {
    const user = userEvent.setup();
    render(
      <ProductGallery
        productName="Wooden blocks"
        images={[
          {
            url: 'https://cdn.example.test/a.webp',
            alt: 'Front',
            width: 800,
            height: 800,
            blurhash: null,
          },
          {
            url: 'https://cdn.example.test/b.webp',
            alt: 'Back',
            width: 800,
            height: 800,
            blurhash: null,
          },
        ]}
      />,
    );

    // Two thumbnail buttons for two images.
    const thumbs = screen.getAllByRole('button');
    expect(thumbs).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    // The second thumbnail becomes current.
    expect(screen.getByRole('button', { name: 'Back' })).toHaveAttribute('aria-current', 'true');
  });
});

describe('ProductDetail', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_MEDIA_BASE_URL', 'https://cdn.example.test');
  });

  const render_ = (product: ProductDoc = aProduct()) =>
    render(
      <ProductDetail
        product={{ ...product, id: 'wooden-blocks' }}
        variants={[aVariant()]}
        categoryName="Wooden toys"
      />,
    );

  it('renders the product name, brand and breadcrumb trail', () => {
    render_();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Wooden building blocks' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wooden toys' })).toHaveAttribute(
      'href',
      '/c/building-sets',
    );
  });

  it('renders in-the-box, skills and safety only when present', () => {
    render_();
    expect(screen.getByText(content.product.inTheBoxTitle)).toBeInTheDocument();
    expect(screen.getByText('240 blocks')).toBeInTheDocument();
    expect(screen.getByText(content.product.skillsTitle)).toBeInTheDocument();
    expect(screen.getByText(content.product.safetyTitle)).toBeInTheDocument();
    // The seeded product is BIS certified — the label and number render.
    expect(
      screen.getByText(new RegExp(content.product.bisCertifiedLabel, 'u')),
    ).toBeInTheDocument();
  });

  it('omits the safety section when a product makes no safety claims', () => {
    const bare = aProduct({
      safety: {
        bisCertified: false,
        bisCertNo: null,
        bisCertExpiry: null,
        bpaFree: false,
        hasSmallParts: false,
      },
    });
    render_(bare);
    expect(screen.queryByText(content.product.safetyTitle)).not.toBeInTheDocument();
  });

  it('shows a choking-hazard warning when the product has small parts', () => {
    const risky = aProduct({
      safety: {
        bisCertified: false,
        bisCertNo: null,
        bisCertExpiry: null,
        bpaFree: false,
        hasSmallParts: true,
      },
    });
    render_(risky);
    expect(screen.getByText(content.product.smallPartsWarning)).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render_();
    await expectNoAxeViolations(container);
  });
});
