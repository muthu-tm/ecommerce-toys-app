import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The product form binds the pure mapping to inputs and the API. `@/lib/api` and
 * `next/navigation` are mocked so the browser SDK never loads and the create/edit navigation
 * is observable. The mapping itself is tested in `product-form.test.ts`; here the concern is
 * that the form submits the mapped request, switches to the SEO tab, and shows the conditional
 * BIS fields.
 */

const createProduct = vi.hoisted(() => vi.fn(() => Promise.resolve({ id: 'new-1', slug: 's' })));
const updateProduct = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const push = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  adminApi: { createProduct, updateProduct },
  ApiError: class ApiError extends Error {},
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));

const { ProductForm } = await import('./ProductForm');

const categories = [{ id: 'building-sets', slug: 'building-sets', name: 'Building sets' }];

beforeEach(() => {
  createProduct.mockClear();
  updateProduct.mockClear();
  push.mockClear();
});

describe('ProductForm — create', () => {
  it('submits the mapped create request and navigates to the new product', async () => {
    const user = userEvent.setup();
    render(<ProductForm categories={categories} />);

    await user.type(screen.getByLabelText(/^Name/u), 'Wooden Blocks');
    await user.type(screen.getByLabelText(/^Description/u), 'A set of blocks.');
    await user.type(screen.getByLabelText(/^Brand/u), 'Woodwise');
    await user.selectOptions(screen.getByLabelText(/Category/u), 'building-sets');
    await user.type(screen.getByLabelText(/Age band/u), '6-8');

    await user.click(screen.getByRole('button', { name: 'Create product' }));

    await waitFor(() => {
      expect(createProduct).toHaveBeenCalledOnce();
    });
    expect(createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Wooden Blocks', categorySlug: 'building-sets' }),
    );
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/products/new-1');
    });
  });

  it('reveals the BIS certificate fields only when certified', async () => {
    const user = userEvent.setup();
    render(<ProductForm categories={categories} />);

    expect(screen.queryByLabelText(/BIS certificate number/u)).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('BIS certified'));
    expect(screen.getByLabelText(/BIS certificate number/u)).toBeInTheDocument();
  });

  it('switches to the SEO tab', async () => {
    const user = userEvent.setup();
    render(<ProductForm categories={categories} />);

    await user.click(screen.getByRole('tab', { name: 'SEO' }));
    expect(screen.getByLabelText(/SEO title/u)).toBeInTheDocument();
    expect(screen.getByLabelText(/index this product/u)).toBeInTheDocument();
  });
});

describe('ProductForm — edit', () => {
  it('disables the slug field and saves via update', async () => {
    const user = userEvent.setup();
    render(
      <ProductForm
        productId="p1"
        initial={{
          name: 'Existing',
          slug: 'existing',
          description: 'desc',
          brand: 'B',
          categoryId: 'building-sets',
          categorySlug: 'building-sets',
          ageBand: '6-8',
          badge: '',
          skills: '',
          boxItems: '',
          bisCertified: false,
          bisCertNo: '',
          bisCertExpiry: '',
          bpaFree: false,
          hasSmallParts: false,
          seoTitle: '',
          seoDescription: '',
          seoIndex: true,
        }}
        categories={categories}
      />,
    );

    expect(screen.getByLabelText(/^Slug/u)).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(updateProduct).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ name: 'Existing' }),
      );
    });
  });
});
