import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SlugSchema, money } from '@romp/contracts';
import type { ProductDoc } from '@romp/contracts';
import { aProduct } from '@romp/contracts/fixtures';
import type { WithId } from '@romp/data';

import { ProductList } from './ProductList';

const slug = (value: string): ProductDoc['slug'] => SlugSchema.parse(value);

/**
 * The product list renders every status and links each row to its edit page. The empty
 * state is a plain affordance. These are the assertions that catch a status badge or a link
 * target regressing.
 */

function product(overrides: Partial<ProductDoc> & { id: string }): WithId<ProductDoc> {
  const { id, ...rest } = overrides;
  return { ...aProduct(rest), id };
}

describe('ProductList', () => {
  it('shows the empty state when there are no products', () => {
    render(<ProductList products={[]} />);
    expect(screen.getByText(/no products yet/iu)).toBeInTheDocument();
  });

  it('lists products with their status and links to the edit page', () => {
    render(
      <ProductList
        products={[
          product({ id: 'p1', name: 'Draft Toy', slug: slug('draft-toy'), status: 'draft' }),
          product({ id: 'p2', name: 'Live Toy', slug: slug('live-toy'), status: 'active' }),
        ]}
      />,
    );

    expect(screen.getByText('Draft Toy')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();

    const editLink = screen.getByRole('link', { name: /live toy/iu });
    expect(editLink).toHaveAttribute('href', '/products/p2');
  });

  it('shows a dash for a product with no variants rather than a zero price', () => {
    render(
      <ProductList
        products={[
          product({
            id: 'p3',
            name: 'No Variants',
            slug: slug('no-variants'),
            status: 'draft',
            variantSummary: [],
            priceFromMinor: money(0),
          }),
        ]}
      />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
