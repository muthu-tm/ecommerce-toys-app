import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { InventoryDoc, WarehouseDoc } from '@romp/contracts';
import { anInventoryRecord, aWarehouse } from '@romp/contracts/fixtures';
import type { WithId } from '@romp/data';

/**
 * The inventory editor lists each warehouse's on-hand count and posts a signed adjustment. The
 * concern here is what the component decides before and after the API call: it renders every
 * warehouse (zero when the variant has no stock), it validates the delta and the note-for-an-
 * adjustment rule before sending, and on success it applies the returned balance to its own
 * counts. The transaction itself is covered against the emulator in `infra/tests`.
 */

const adjustInventory = vi.hoisted(() =>
  vi.fn(() =>
    Promise.resolve({
      variantId: 'WB-240',
      onHandTotal: 25,
      reserved: 0,
      stock: { blr: 25, del: 8 },
    }),
  ),
);
const refresh = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  adminApi: { adjustInventory },
  ApiError: class ApiError extends Error {},
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

const { InventoryEditor } = await import('./InventoryEditor');

type Code = ReturnType<typeof aWarehouse>['code'];
type Stock = ReturnType<typeof anInventoryRecord>['stock'];

function warehouse(code: string, name: string, priority: number): WithId<WarehouseDoc> {
  const doc = aWarehouse({ code: code as Code, name, priority });
  return { ...doc, id: doc.code };
}

function inventory(stock: Record<string, number>, reserved = 0): WithId<InventoryDoc> {
  const onHandTotal = Object.values(stock).reduce((total, units) => total + units, 0);
  return {
    ...anInventoryRecord({ stock: stock as unknown as Stock, onHandTotal, reserved }),
    id: 'WB-240',
  };
}

const WAREHOUSES: readonly WithId<WarehouseDoc>[] = [
  warehouse('blr', 'Bengaluru hub', 0),
  warehouse('del', 'Delhi hub', 1),
];

beforeEach(() => {
  adjustInventory.mockClear();
  refresh.mockClear();
});

describe('InventoryEditor', () => {
  it('lists every warehouse with its on-hand count', () => {
    render(
      <InventoryEditor
        productId="p1"
        variantId="WB-240"
        variantName="240 pieces"
        warehouses={WAREHOUSES}
        inventory={inventory({ blr: 12, del: 8 })}
      />,
    );
    // The name appears in both the stock list and the warehouse select, so assert the unique
    // per-warehouse counts.
    expect(screen.getByText('12 in stock')).toBeInTheDocument();
    expect(screen.getByText('8 in stock')).toBeInTheDocument();
  });

  it('shows a warehouse the variant holds nothing at, defaulted to zero', () => {
    render(
      <InventoryEditor
        productId="p1"
        variantId="WB-240"
        variantName="240 pieces"
        warehouses={WAREHOUSES}
        inventory={inventory({ blr: 5 })}
      />,
    );
    // Delhi has no key in the stock map — rendered at zero.
    expect(screen.getByText('0 in stock')).toBeInTheDocument();
  });

  it('renders every warehouse at zero when the variant has no inventory yet', () => {
    render(
      <InventoryEditor
        productId="p1"
        variantId="WB-240"
        variantName="240 pieces"
        warehouses={WAREHOUSES}
        inventory={null}
      />,
    );
    expect(screen.getAllByText('0 in stock')).toHaveLength(2);
  });

  it('posts a signed adjustment with the chosen warehouse, reason and note', async () => {
    const user = userEvent.setup();
    render(
      <InventoryEditor
        productId="p1"
        variantId="WB-240"
        variantName="240 pieces"
        warehouses={WAREHOUSES}
        inventory={inventory({ blr: 12, del: 8 })}
      />,
    );

    await user.type(screen.getByLabelText(/Change/u), '13');
    await user.type(screen.getByLabelText(/Note/u), 'Recount found more.');
    await user.click(screen.getByRole('button', { name: 'Apply adjustment' }));

    await waitFor(() => {
      expect(adjustInventory).toHaveBeenCalledWith('p1', 'WB-240', {
        warehouseId: 'blr',
        delta: 13,
        reason: 'adjustment',
        note: 'Recount found more.',
      });
    });
  });

  it('applies the returned balance to the counts after a successful adjustment', async () => {
    const user = userEvent.setup();
    render(
      <InventoryEditor
        productId="p1"
        variantId="WB-240"
        variantName="240 pieces"
        warehouses={WAREHOUSES}
        inventory={inventory({ blr: 12, del: 8 })}
      />,
    );

    await user.type(screen.getByLabelText(/Change/u), '13');
    await user.type(screen.getByLabelText(/Note/u), 'Recount found more.');
    await user.click(screen.getByRole('button', { name: 'Apply adjustment' }));

    // The mock returns blr: 25 — the row updates without a reload.
    await waitFor(() => {
      expect(screen.getByText('25 in stock')).toBeInTheDocument();
    });
  });

  it('rejects a zero delta before calling the API', async () => {
    const user = userEvent.setup();
    render(
      <InventoryEditor
        productId="p1"
        variantId="WB-240"
        variantName="240 pieces"
        warehouses={WAREHOUSES}
        inventory={null}
      />,
    );

    await user.type(screen.getByLabelText(/Change/u), '0');
    await user.type(screen.getByLabelText(/Note/u), 'x');
    await user.click(screen.getByRole('button', { name: 'Apply adjustment' }));

    expect(screen.getByText(/whole, non-zero/u)).toBeInTheDocument();
    expect(adjustInventory).not.toHaveBeenCalled();
  });

  it('requires a note for a manual adjustment before calling the API', async () => {
    const user = userEvent.setup();
    render(
      <InventoryEditor
        productId="p1"
        variantId="WB-240"
        variantName="240 pieces"
        warehouses={WAREHOUSES}
        inventory={null}
      />,
    );

    await user.type(screen.getByLabelText(/Change/u), '5');
    await user.click(screen.getByRole('button', { name: 'Apply adjustment' }));

    expect(screen.getByText(/needs a note/u)).toBeInTheDocument();
    expect(adjustInventory).not.toHaveBeenCalled();
  });

  it('allows a reconciliation without a note', async () => {
    const user = userEvent.setup();
    render(
      <InventoryEditor
        productId="p1"
        variantId="WB-240"
        variantName="240 pieces"
        warehouses={WAREHOUSES}
        inventory={null}
      />,
    );

    await user.type(screen.getByLabelText(/Change/u), '5');
    await user.selectOptions(screen.getByLabelText(/Reason/u), 'reconciliation');
    await user.click(screen.getByRole('button', { name: 'Apply adjustment' }));

    await waitFor(() => {
      expect(adjustInventory).toHaveBeenCalledWith('p1', 'WB-240', {
        warehouseId: 'blr',
        delta: 5,
        reason: 'reconciliation',
        note: null,
      });
    });
  });
});
