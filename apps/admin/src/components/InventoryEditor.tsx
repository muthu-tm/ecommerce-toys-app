'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type {
  InventoryAdjustRequest,
  InventoryDoc,
  InventoryResponse,
  WarehouseDoc,
} from '@romp/contracts';
import type { WithId } from '@romp/data';
import { Badge, Button, Field } from '@romp/ui';

import { ApiError, adminApi } from '@/lib/api';

/**
 * The per-variant, per-warehouse stock editor on a product's edit page.
 *
 * Shows the variant's current on-hand count at every seeded warehouse — including the ones
 * holding nothing, so a receiving-in adjustment has a row to land on — and offers a single form
 * to move stock: pick a warehouse, enter a signed delta, choose a reason and (for a manual
 * adjustment) explain it. The write appends a ledger entry and updates the balance in one
 * transaction on the server; this component applies the returned balance to its own state so
 * the counts update without a full page reload, and refreshes the route so the rest of the page
 * (the low-stock badge, say) stays consistent.
 *
 * Copy here is generic backoffice language, not brand voice — an operator tool, not a storefront
 * surface — so there is nothing store-specific to configure.
 */

type Reason = InventoryAdjustRequest['reason'];

const REASONS: readonly { readonly value: Reason; readonly label: string }[] = [
  { value: 'adjustment', label: 'Adjustment (recount, damage, correction)' },
  { value: 'reconciliation', label: 'Reconciliation (set to physical count)' },
];

/** The per-warehouse on-hand map, defaulting every warehouse to zero. */
function stockByWarehouse(
  warehouses: readonly WithId<WarehouseDoc>[],
  stock: Readonly<Record<string, number>> | undefined,
): readonly { readonly code: string; readonly name: string; readonly units: number }[] {
  return warehouses.map((warehouse) => ({
    code: warehouse.code,
    name: warehouse.name,
    units: stock?.[warehouse.code] ?? 0,
  }));
}

export function InventoryEditor({
  productId,
  variantId,
  variantName,
  warehouses,
  inventory,
}: {
  readonly productId: string;
  readonly variantId: string;
  readonly variantName: string;
  readonly warehouses: readonly WithId<WarehouseDoc>[];
  readonly inventory: WithId<InventoryDoc> | null;
}) {
  const router = useRouter();
  const [stock, setStock] = useState<Readonly<Record<string, number>>>(inventory?.stock ?? {});
  const [warehouseId, setWarehouseId] = useState<string>(warehouses[0]?.code ?? '');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState<Reason>('adjustment');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = stockByWarehouse(warehouses, stock);

  const submit = (): void => {
    if (warehouseId === '') {
      setError('Choose a warehouse.');
      return;
    }
    const parsed = Number(delta);
    if (!Number.isInteger(parsed) || parsed === 0) {
      setError('Enter a whole, non-zero number of units — negative to remove stock.');
      return;
    }
    const trimmedNote = note.trim();
    if (reason === 'adjustment' && trimmedNote === '') {
      setError('A manual adjustment needs a note explaining it.');
      return;
    }

    const body: InventoryAdjustRequest = {
      warehouseId: warehouseId as InventoryAdjustRequest['warehouseId'],
      delta: parsed,
      reason,
      note: trimmedNote === '' ? null : trimmedNote,
    };

    setSaving(true);
    setError(null);
    void adminApi
      .adjustInventory(productId, variantId, body)
      .then((result: InventoryResponse) => {
        setStock(result.stock);
        setDelta('');
        setNote('');
        router.refresh();
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : 'Could not adjust the stock.');
      })
      .finally(() => {
        setSaving(false);
      });
  };

  return (
    <section aria-labelledby={`inventory-${variantId}`} className="flex flex-col gap-4">
      <h3
        id={`inventory-${variantId}`}
        className="font-body text-sm font-semibold text-text-primary"
      >
        Stock — {variantName}
      </h3>

      {warehouses.length === 0 ? (
        <p className="font-body text-sm text-text-muted">
          No warehouses configured. Seed the store’s warehouses before adjusting stock.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.code}
              className="flex items-center justify-between rounded-md border border-border bg-surface px-4 py-2"
            >
              <span className="flex flex-col">
                <span className="font-body font-semibold text-text-primary">{row.name}</span>
                <span className="font-body text-sm text-text-muted">{row.code}</span>
              </span>
              <Badge tone={row.units === 0 ? 'neutral' : 'success'}>{row.units} in stock</Badge>
            </li>
          ))}
        </ul>
      )}

      {warehouses.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-md border border-border p-4">
          <h4 className="font-body text-sm font-semibold text-text-primary">Adjust stock</h4>

          <label className="flex flex-col gap-1.5">
            <span className="font-body text-sm font-semibold text-text-primary">Warehouse</span>
            <select
              className="min-h-11 rounded-md border border-border-strong bg-surface px-3 font-body text-base text-text-primary"
              value={warehouseId}
              onChange={(event) => {
                setWarehouseId(event.target.value);
              }}
            >
              {warehouses.map((warehouse) => (
                <option key={warehouse.code} value={warehouse.code}>
                  {warehouse.name}
                </option>
              ))}
            </select>
          </label>

          <Field
            label="Change (units)"
            inputMode="numeric"
            placeholder="e.g. 12 to add, -3 to remove"
            value={delta}
            onChange={(event) => {
              setDelta(event.target.value);
            }}
          />

          <label className="flex flex-col gap-1.5">
            <span className="font-body text-sm font-semibold text-text-primary">Reason</span>
            <select
              className="min-h-11 rounded-md border border-border-strong bg-surface px-3 font-body text-base text-text-primary"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value as Reason);
              }}
            >
              {REASONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <Field
            label={reason === 'adjustment' ? 'Note (required)' : 'Note (optional)'}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />

          {error !== null ? (
            <p role="alert" className="font-body text-sm text-danger">
              {error}
            </p>
          ) : null}

          <div>
            <Button type="button" loading={saving} onClick={submit}>
              Apply adjustment
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
