import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { OrderDoc, OrderEventDoc } from '@romp/contracts';
import { anOrder, anOrderEvent } from '@romp/contracts/fixtures';
import type { WithId } from '@romp/data';

/**
 * The order detail renders the summary, the amounts and the audit timeline, and embeds the
 * operational controls. The timeline humanises event types oldest-first. `@/lib/api` is mocked so
 * the browser Firebase SDK the embedded actions transitively import never loads in jsdom, and
 * `next/navigation` is mocked because the actions are a client island using the router.
 */

vi.mock('@/lib/api', () => ({
  adminApi: { advanceFulfilment: vi.fn(), cancelOrder: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const { OrderDetail } = await import('./OrderDetail');

const order: WithId<OrderDoc> = { ...anOrder({ status: 'paid' }), id: 'order-1' };

function event(type: string, overrides: Partial<OrderEventDoc> = {}): WithId<OrderEventDoc> {
  return { ...anOrderEvent({ type, ...overrides }), id: `${type}-1` };
}

describe('OrderDetail', () => {
  it('shows the order number and its status badges', () => {
    render(<OrderDetail order={order} events={[]} />);
    expect(screen.getByRole('heading', { name: order.humanId })).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('Unfulfilled')).toBeInTheDocument();
  });

  it('lists the line items and the total', () => {
    render(<OrderDetail order={order} events={[]} />);
    expect(screen.getByText(order.items[0]!.name)).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
  });

  it('renders the audit timeline with humanised event labels', () => {
    render(
      <OrderDetail
        order={order}
        events={[event('order.created'), event('order.payment_verified')]}
      />,
    );
    expect(screen.getByText('Order placed')).toBeInTheDocument();
    expect(screen.getByText('Payment verified')).toBeInTheDocument();
  });

  it('shows an empty history when there are no events', () => {
    render(<OrderDetail order={order} events={[]} />);
    expect(screen.getByText(/no events recorded/iu)).toBeInTheDocument();
  });

  it('offers fulfilment controls for a paid order', () => {
    render(<OrderDetail order={order} events={[]} />);
    // Paid + unfulfilled -> packing is offered (the cross-machine gate is satisfied).
    expect(screen.getByRole('button', { name: 'Mark packed' })).toBeInTheDocument();
  });
});
