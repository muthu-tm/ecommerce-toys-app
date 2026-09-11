import { describe, expect, it } from 'vitest';

import { money } from '@romp/contracts';
import type { BasisPoints } from '@romp/contracts';

import {
  allocateStock,
  applyReservation,
  buildUpiUri,
  computeOrderTotals,
  formatOrderNumber,
} from './order';
import type { OrderTotalsSettings } from './order';

/**
 * The pure order-placement logic: the server-authoritative totals, the UPI intent string, the order
 * number format, warehouse allocation, and the reservation check. Totals are what a customer is
 * charged, so they are tested exhaustively — every fee path, the GST base, and the exact-sum
 * invariant the order schema enforces.
 */

const gst = (bps: number) => bps as BasisPoints;

const settings = (overrides: Partial<OrderTotalsSettings> = {}): OrderTotalsSettings => ({
  gstRateBasisPoints: gst(1800),
  giftWrapFeeMinor: money(9_900),
  expressFeeMinor: money(14_900),
  standardShippingFeeMinor: money(5_900),
  freeShippingThresholdMinor: money(1_49_900),
  ...overrides,
});

const line = (unit: number, qty: number) => ({ unitPriceMinor: money(unit), qty });

describe('computeOrderTotals', () => {
  it('sums line totals into the subtotal', () => {
    const totals = computeOrderTotals(
      [line(1_00_000, 2), line(50_000, 1)],
      { giftWrap: false, deliverySpeed: 'standard' },
      settings({ freeShippingThresholdMinor: money(0), standardShippingFeeMinor: money(0) }),
    );
    expect(totals.subtotalMinor).toBe(2_50_000);
  });

  it('charges standard shipping below the free threshold and none at or above it', () => {
    const below = computeOrderTotals(
      [line(1_00_000, 1)],
      { giftWrap: false, deliverySpeed: 'standard' },
      settings(),
    );
    expect(below.shippingMinor).toBe(5_900);

    const above = computeOrderTotals(
      [line(1_49_900, 1)],
      { giftWrap: false, deliverySpeed: 'standard' },
      settings(),
    );
    expect(above.shippingMinor).toBe(0);
  });

  it('adds the express surcharge on top of shipping', () => {
    const totals = computeOrderTotals(
      [line(1_00_000, 1)],
      { giftWrap: false, deliverySpeed: 'express' },
      settings(),
    );
    // standard 5_900 + express 14_900
    expect(totals.shippingMinor).toBe(20_800);
  });

  it('adds the gift-wrap fee only when requested', () => {
    const wrapped = computeOrderTotals(
      [line(1_00_000, 1)],
      { giftWrap: true, deliverySpeed: 'standard' },
      settings(),
    );
    expect(wrapped.giftWrapMinor).toBe(9_900);

    const plain = computeOrderTotals(
      [line(1_00_000, 1)],
      { giftWrap: false, deliverySpeed: 'standard' },
      settings(),
    );
    expect(plain.giftWrapMinor).toBe(0);
  });

  it('applies GST to the whole taxable value (subtotal + gift wrap + shipping)', () => {
    const totals = computeOrderTotals(
      [line(1_00_000, 1)],
      { giftWrap: true, deliverySpeed: 'standard' },
      settings(),
    );
    // taxable = 100000 + 9900 + 5900 = 115800; 18% = 20844
    expect(totals.taxMinor).toBe(20_844);
  });

  it('produces a total that equals subtotal + giftWrap + shipping + tax (the order invariant)', () => {
    const totals = computeOrderTotals(
      [line(1_00_000, 2), line(33_333, 1)],
      { giftWrap: true, deliverySpeed: 'express' },
      settings(),
    );
    expect(totals.totalMinor).toBe(
      totals.subtotalMinor + totals.giftWrapMinor + totals.shippingMinor + totals.taxMinor,
    );
  });

  it('is all zeros for an empty order', () => {
    const totals = computeOrderTotals(
      [],
      { giftWrap: false, deliverySpeed: 'standard' },
      settings(),
    );
    expect(totals).toEqual({
      subtotalMinor: 0,
      giftWrapMinor: 0,
      shippingMinor: 5_900,
      taxMinor: applyGst(5_900),
      totalMinor: 5_900 + applyGst(5_900),
    });
  });
});

/** Local GST helper mirroring applyTaxBps at 18% for the empty-order assertion. */
function applyGst(amount: number): number {
  return Math.round((amount * 1800) / 10_000);
}

describe('formatOrderNumber', () => {
  it('joins the prefix and the counter value', () => {
    expect(formatOrderNumber('RMP', 24_817)).toBe('RMP-24817');
  });
});

describe('buildUpiUri', () => {
  it('encodes the vpa, payee, exact rupee amount, note and INR currency', () => {
    const uri = buildUpiUri({
      vpa: 'romp@okhdfcbank',
      payeeName: 'ROMP Toys',
      amountMinor: money(2_90_976),
      note: 'RMP-24817',
    });
    expect(uri).toBe(
      'upi://pay?pa=romp%40okhdfcbank&pn=ROMP%20Toys&am=2909.76&tn=RMP-24817&cu=INR',
    );
  });

  it('formats a whole-rupee amount with two decimals', () => {
    const uri = buildUpiUri({
      vpa: 'x@y',
      payeeName: 'X',
      amountMinor: money(1_00_000),
      note: 'N',
    });
    expect(uri).toContain('am=1000.00');
  });
});

describe('allocateStock', () => {
  it('fills from the highest-priority warehouse first', () => {
    const allocation = allocateStock(5, [
      { warehouseId: 'blr', stock: 3 },
      { warehouseId: 'del', stock: 10 },
    ]);
    expect(allocation).toEqual({ blr: 3, del: 2 });
  });

  it('takes all from one warehouse when it suffices', () => {
    expect(allocateStock(2, [{ warehouseId: 'blr', stock: 10 }])).toEqual({ blr: 2 });
  });

  it('returns null when the warehouses together cannot cover the quantity', () => {
    expect(
      allocateStock(5, [
        { warehouseId: 'blr', stock: 2 },
        { warehouseId: 'del', stock: 1 },
      ]),
    ).toBeNull();
  });

  it('omits a warehouse that contributes nothing', () => {
    const allocation = allocateStock(3, [
      { warehouseId: 'blr', stock: 3 },
      { warehouseId: 'del', stock: 5 },
    ]);
    expect(allocation).toEqual({ blr: 3 });
  });
});

describe('applyReservation', () => {
  it('raises reserved by the quantity when enough is available', () => {
    expect(applyReservation({ onHandTotal: 10, reserved: 2 }, 3)).toEqual({
      ok: true,
      reserved: 5,
    });
  });

  it('allows reserving exactly the available quantity', () => {
    expect(applyReservation({ onHandTotal: 10, reserved: 7 }, 3)).toEqual({
      ok: true,
      reserved: 10,
    });
  });

  it('refuses reserving more than is available', () => {
    expect(applyReservation({ onHandTotal: 10, reserved: 8 }, 3)).toEqual({ ok: false });
  });
});
