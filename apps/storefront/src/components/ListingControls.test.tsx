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
 * The sort control.
 *
 * The behaviour worth testing is what it writes to the URL. The load-bearing assertion
 * is that **every change drops the cursor**.
 */
describe('ListingControls', () => {
  beforeEach(() => {
    push.mockClear();
    currentParams = new URLSearchParams();
  });

  it('writes the chosen sort to the URL', async () => {
    render(<ListingControls sort="newest" />);

    await userEvent.selectOptions(screen.getByRole('combobox'), 'price_asc');

    expect(push).toHaveBeenCalledWith(expect.stringContaining('sort=price_asc'));
  });

  it('drops the cursor when the sort changes', async () => {
    currentParams = new URLSearchParams({ sort: 'newest', cursor: 'STALE' });
    render(<ListingControls sort="newest" />);

    await userEvent.selectOptions(screen.getByRole('combobox'), 'rating_desc');

    const target = push.mock.calls[0]?.[0] as string;
    expect(target).toContain('sort=rating_desc');
    expect(target).not.toContain('cursor');
  });

  it('drops a price filter when switching to rating sort', async () => {
    currentParams = new URLSearchParams({ minPrice: '50000', sort: 'price_asc' });
    render(<ListingControls sort="price_asc" />);

    await userEvent.selectOptions(screen.getByRole('combobox'), 'rating_desc');

    const target = push.mock.calls[0]?.[0] as string;
    expect(target).toContain('sort=rating_desc');
    expect(target).not.toContain('minPrice');
  });

  it('omits the default sort from the URL', async () => {
    currentParams = new URLSearchParams({ sort: 'price_asc' });
    render(<ListingControls sort="price_asc" />);

    await userEvent.selectOptions(screen.getByRole('combobox'), 'newest');

    expect(push).toHaveBeenCalledWith('/c/wooden');
  });

  it('reflects the current sort', () => {
    render(<ListingControls sort="price_desc" />);

    expect(screen.getByRole('combobox')).toHaveValue('price_desc');
  });
});
