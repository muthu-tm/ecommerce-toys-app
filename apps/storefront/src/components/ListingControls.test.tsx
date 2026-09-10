import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
let currentParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/c/wooden',
  useSearchParams: () => currentParams,
}));

import { ListingControls } from './ListingControls';

/**
 * The sort/filter controls.
 *
 * The behaviour worth testing is what they write to the URL, because that is the whole
 * mechanism: the state lives in the query string, the server re-renders from it. The
 * router is faked so a `push` is observable.
 *
 * The load-bearing assertion is that **every change drops the cursor**. A cursor is bound
 * to the sort that produced it; carrying one across a sort change is exactly what
 * `decodeCursor` rejects, so resetting to page one here is what keeps the customer from
 * ever seeing that error.
 */
describe('ListingControls', () => {
  beforeEach(() => {
    push.mockClear();
    currentParams = new URLSearchParams();
  });

  it('writes the chosen sort to the URL', async () => {
    render(<ListingControls sort="newest" inStockOnly={false} />);

    await userEvent.selectOptions(screen.getByRole('combobox'), 'price_asc');

    expect(push).toHaveBeenCalledWith(expect.stringContaining('sort=price_asc'));
  });

  it('drops the cursor when the sort changes', async () => {
    // A cursor from a price-sorted page is meaningless under a rating sort.
    currentParams = new URLSearchParams({ sort: 'newest', cursor: 'STALE' });
    render(<ListingControls sort="newest" inStockOnly={false} />);

    await userEvent.selectOptions(screen.getByRole('combobox'), 'rating_desc');

    const target = push.mock.calls[0]?.[0] as string;
    expect(target).toContain('sort=rating_desc');
    expect(target).not.toContain('cursor');
  });

  it('adds the in-stock param when checked', async () => {
    render(<ListingControls sort="newest" inStockOnly={false} />);

    await userEvent.click(screen.getByRole('checkbox'));

    expect(push).toHaveBeenCalledWith(expect.stringContaining('inStock=true'));
  });

  it('removes the in-stock param when unchecked, rather than writing false', async () => {
    // An absent param is the default; `inStock=false` would be clutter in the URL.
    currentParams = new URLSearchParams({ inStock: 'true' });
    render(<ListingControls sort="newest" inStockOnly />);

    await userEvent.click(screen.getByRole('checkbox'));

    const target = push.mock.calls[0]?.[0] as string;
    expect(target).not.toContain('inStock');
  });

  it('reflects the current state', () => {
    render(<ListingControls sort="price_desc" inStockOnly />);

    expect(screen.getByRole('combobox')).toHaveValue('price_desc');
    expect(screen.getByRole('checkbox')).toBeChecked();
  });
});
