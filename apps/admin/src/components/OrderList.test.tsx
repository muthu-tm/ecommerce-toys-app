import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { OrderDoc } from '@romp/contracts';
import { anOrder } from '@romp/contracts/fixtures';
import type { WithId } from '@romp/data';

import { OrderList } from './OrderList';

/**
 * The order list renders each order with its two status badges and links to the detail page, offers
 * the status filters and search, and shows a next-page control only when there is another page.
 */

function order(overrides: Partial<OrderDoc> & { id: string }): WithId<OrderDoc> {
  const { id, ...rest } = overrides;
  return { ...anOrder(rest), id };
}

describe('OrderList', () => {
  it('shows the empty state when there are no orders', () => {
    render(<OrderList orders={[]} nextCursor={null} />);
    expect(screen.getByText(/no orders match/iu)).toBeInTheDocument();
  });

  it('lists orders with both status badges and links to the detail page', () => {
    render(
      <OrderList
        orders={[order({ id: 'o1', humanId: 'RMP-1001' as OrderDoc['humanId'], status: 'paid' })]}
        nextCursor={null}
      />,
    );

    const row = screen.getByRole('listitem');
    expect(within(row).getByText('RMP-1001')).toBeInTheDocument();
    // The status badges live in the row; "Paid" also appears as a filter pill, so scope to the row.
    expect(within(row).getByText('Paid')).toBeInTheDocument();
    expect(within(row).getByText('Unfulfilled')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: /RMP-1001/u })).toHaveAttribute(
      'href',
      '/orders/o1',
    );
  });

  it('offers the status filters, marking the active one', () => {
    render(<OrderList orders={[]} nextCursor={null} activeStatus="paid" />);
    const paidFilter = screen.getByRole('link', { name: 'Paid' });
    expect(paidFilter).toHaveAttribute('href', '/orders?status=paid');
    expect(paidFilter).toHaveAttribute('aria-current', 'page');
  });

  it('shows a next-page link carrying the cursor', () => {
    render(<OrderList orders={[]} nextCursor="CURSOR123" activeStatus="paid" />);
    const next = screen.getByRole('link', { name: 'Next page' });
    expect(next.getAttribute('href')).toContain('cursor=CURSOR123');
    expect(next.getAttribute('href')).toContain('status=paid');
  });

  it('hides the next-page link on the last page', () => {
    render(<OrderList orders={[]} nextCursor={null} />);
    expect(screen.queryByRole('link', { name: 'Next page' })).not.toBeInTheDocument();
  });

  it('has a search field for the order number', () => {
    render(<OrderList orders={[]} nextCursor={null} humanId="RMP-1001" />);
    expect(screen.getByRole('searchbox', { name: /order number/iu })).toHaveValue('RMP-1001');
  });
});
