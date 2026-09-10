import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { money } from '@romp/contracts';
import type { VariantDoc } from '@romp/contracts';
import { aVariant } from '@romp/contracts/fixtures';
import type { WithId } from '@romp/data';

/**
 * The variant editor lists variants (active and inactive) and adds one through the API. The
 * rupee→paise conversion is the pure part (tested in product-form.test.ts); here the concern
 * is that the add flow posts the mapped request and that an invalid price is caught before a
 * request is sent.
 */

const createVariant = vi.hoisted(() => vi.fn(() => Promise.resolve({ id: 'v-new' })));
const refresh = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  adminApi: { createVariant },
  ApiError: class ApiError extends Error {},
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

const { VariantEditor } = await import('./VariantEditor');

function variant(overrides: Partial<VariantDoc> & { id: string }): WithId<VariantDoc> {
  const { id, ...rest } = overrides;
  return { ...aVariant(rest), id };
}

beforeEach(() => {
  createVariant.mockClear();
  refresh.mockClear();
});

describe('VariantEditor', () => {
  it('lists variants with their active state', () => {
    render(
      <VariantEditor
        productId="p1"
        variants={[
          variant({ id: 'v1', name: 'Active one', active: true, priceMinor: money(2_00_000) }),
          variant({ id: 'v2', name: 'Inactive one', active: false }),
        ]}
      />,
    );
    expect(screen.getByText('Active one')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('posts a mapped variant request, converting rupees to paise', async () => {
    const user = userEvent.setup();
    render(<VariantEditor productId="p1" variants={[]} />);

    await user.type(screen.getByLabelText(/^Name/u), '240 pieces');
    await user.type(screen.getByLabelText(/^SKU/u), 'WB-240');
    await user.type(screen.getByLabelText(/Price/u), '1299');
    await user.type(screen.getByLabelText(/MRP/u), '1499');
    await user.type(screen.getByLabelText(/Weight/u), '800');

    await user.click(screen.getByRole('button', { name: 'Add variant' }));

    await waitFor(() => {
      expect(createVariant).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ priceMinor: 129_900, mrpMinor: 149_900, weightGrams: 800 }),
      );
    });
  });

  it('shows a field error for an invalid price without calling the API', async () => {
    const user = userEvent.setup();
    render(<VariantEditor productId="p1" variants={[]} />);

    await user.type(screen.getByLabelText(/Price/u), 'abc');
    await user.type(screen.getByLabelText(/Weight/u), '800');
    await user.click(screen.getByRole('button', { name: 'Add variant' }));

    expect(screen.getByText(/check the price field/iu)).toBeInTheDocument();
    expect(createVariant).not.toHaveBeenCalled();
  });
});
