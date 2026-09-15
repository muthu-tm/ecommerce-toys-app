import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
let currentParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/c/all',
  useSearchParams: () => currentParams,
}));

import { content } from '@/lib/store';

import { ListingFilters } from './ListingFilters';

const CATEGORIES = [
  { slug: 'wooden', name: 'Wooden toys', count: 4 },
  { slug: 'puzzles', name: 'Puzzles', count: 2 },
] as const;

function renderSidebar(
  overrides: Partial<ComponentProps<typeof ListingFilters>> = {},
): void {
  render(
    <ListingFilters
      placement="sidebar"
      selectedCategories={[]}
      selectedAges={[]}
      categories={CATEGORIES}
      minPrice={undefined}
      maxPrice={undefined}
      inStockOnly={false}
      {...overrides}
    />,
  );
}

describe('ListingFilters', () => {
  beforeEach(() => {
    push.mockClear();
    currentParams = new URLSearchParams();
  });

  it('writes an extra category as a repeated c param', async () => {
    renderSidebar();

    await userEvent.click(screen.getByRole('checkbox', { name: /Wooden toys/u }));

    expect(push).toHaveBeenCalledWith(expect.stringContaining('c=wooden'));
  });

  it('does not untoggle the route-locked category', () => {
    renderSidebar({ lockedCategory: 'wooden', selectedCategories: ['wooden'] });

    expect(screen.getByRole('checkbox', { name: /Wooden toys/u })).toBeDisabled();
  });

  it('writes an age band as an age param', async () => {
    renderSidebar();
    const band = content.ageBands[0];
    if (band === undefined) throw new Error('no age bands');

    await userEvent.click(screen.getByRole('button', { name: band.label }));

    expect(push).toHaveBeenCalledWith(expect.stringContaining(`age=${band.value}`));
  });

  it('writes in-stock as a present-or-absent param', async () => {
    renderSidebar();

    await userEvent.click(screen.getByRole('checkbox', { name: 'In stock only' }));

    expect(push).toHaveBeenCalledWith(expect.stringContaining('inStock=true'));
  });

  it('drops the cursor when a filter changes', async () => {
    currentParams = new URLSearchParams({ cursor: 'STALE' });
    renderSidebar();

    await userEvent.click(screen.getByRole('checkbox', { name: 'In stock only' }));

    const target = push.mock.calls[0]?.[0] as string;
    expect(target).not.toContain('cursor');
  });
});
