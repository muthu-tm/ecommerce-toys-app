import {
  addMoney,
  applyTaxBps,
  moneyToRupees,
  multiplyMoney,
  sumMoney,
  ZERO_MONEY,
} from '@romp/contracts';
import type { BasisPoints, Money } from '@romp/contracts';

/**
 * The pure order-placement logic.
 *
 * Totals are server-authoritative — the checkout quote is the only source of truth for what a
 * customer is charged (`API.md`, `V1_SCOPE.md`), so the arithmetic that produces them lives here,
 * pure and exhaustively unit-tested, rather than anywhere a client value could reach it. The same
 * function computes the quote a customer sees and the amounts written onto the order, so the two can
 * never disagree. Also here: the UPI intent string minted at placement (the exact amount and the
 * order number, which is what turns Task 17's manual verification into a two-field match), the
 * human-facing order number format, and the warehouse allocation that fills a line from the
 * highest-priority warehouses first.
 *
 * Nothing here touches Firestore; the `@romp/data` transaction reads the live variant prices and
 * inventory, calls these, and writes the result.
 */

/** A priced line the totals are computed from — the live unit price times the ordered quantity. */
export interface OrderLineInput {
  readonly unitPriceMinor: Money;
  readonly qty: number;
}

/** The runtime commerce parameters the totals depend on, from `settings/checkout`. */
export interface OrderTotalsSettings {
  readonly gstRateBasisPoints: BasisPoints;
  readonly giftWrapFeeMinor: Money;
  readonly expressFeeMinor: Money;
  readonly standardShippingFeeMinor: Money;
  readonly freeShippingThresholdMinor: Money;
}

/** The computed money for an order, matching `OrderAmounts` (refunded is zero at placement). */
export interface OrderTotals {
  readonly subtotalMinor: Money;
  readonly giftWrapMinor: Money;
  readonly shippingMinor: Money;
  readonly taxMinor: Money;
  readonly totalMinor: Money;
}

/**
 * Computes an order's money from its lines and the current settings.
 *
 * The subtotal is the sum of line totals (unit price × quantity). Gift wrap adds its flat fee when
 * requested. Shipping is free at or above the free-shipping threshold, otherwise the flat standard
 * fee, plus the express surcharge for express delivery. GST is then applied to the **whole taxable
 * value** — subtotal plus gift wrap plus shipping — because that is the invoice value the customer
 * is charged on, and taxing only part of it would understate the tax. The total is the sum of all
 * four, which is exactly the invariant `OrderAmounts` enforces on write.
 *
 * Every step is integer paise with a single half-up rounding inside `applyTaxBps`, so the total is
 * reproducible: the quote a customer saw and the amounts written at placement come from this one
 * function and cannot drift.
 */
export function computeOrderTotals(
  lines: readonly OrderLineInput[],
  options: { readonly giftWrap: boolean; readonly deliverySpeed: 'standard' | 'express' },
  settings: OrderTotalsSettings,
): OrderTotals {
  const subtotalMinor =
    lines.length === 0
      ? ZERO_MONEY
      : sumMoney(lines.map((line) => multiplyMoney(line.unitPriceMinor, line.qty)));

  const giftWrapMinor = options.giftWrap ? settings.giftWrapFeeMinor : ZERO_MONEY;

  const baseShipping =
    subtotalMinor >= settings.freeShippingThresholdMinor
      ? ZERO_MONEY
      : settings.standardShippingFeeMinor;
  const shippingMinor =
    options.deliverySpeed === 'express'
      ? addMoney(baseShipping, settings.expressFeeMinor)
      : baseShipping;

  const taxableMinor = addMoney(subtotalMinor, giftWrapMinor, shippingMinor);
  const taxMinor = applyTaxBps(taxableMinor, settings.gstRateBasisPoints);

  const totalMinor = addMoney(subtotalMinor, giftWrapMinor, shippingMinor, taxMinor);

  return { subtotalMinor, giftWrapMinor, shippingMinor, taxMinor, totalMinor };
}

/**
 * The human-facing order number: the store's prefix, a hyphen, and the counter value.
 *
 * Not zero-padded — the counter starts above four digits, which is what `HumanOrderIdSchema` needs,
 * and padding a growing number is a cosmetic choice that eventually stops mattering. This is
 * deliberately separate from the random document ID: a guessed order number must not address a
 * document.
 */
export function formatOrderNumber(orderPrefix: string, counterValue: number): string {
  return `${orderPrefix}-${String(counterValue)}`;
}

/**
 * Builds the UPI intent string encoded into the order's QR.
 *
 * The format is the standard UPI deep link: `upi://pay?pa=<vpa>&pn=<payee>&am=<rupees>&tn=<note>&cu=INR`.
 * The amount is the exact order total in rupees (two decimals) and the note is the order's human
 * number — together they are what makes payment verification a two-field match rather than a
 * judgement call, since the customer's UPI app pre-fills both. The payee name is URL-encoded because
 * it is free text; the amount uses `moneyToRupees` (the one place a `Money` becomes a float, for the
 * `am` field only, never to re-enter a calculation).
 */
export function buildUpiUri(params: {
  readonly vpa: string;
  readonly payeeName: string;
  readonly amountMinor: Money;
  readonly note: string;
}): string {
  const amount = moneyToRupees(params.amountMinor).toFixed(2);
  const query = [
    `pa=${encodeURIComponent(params.vpa)}`,
    `pn=${encodeURIComponent(params.payeeName)}`,
    `am=${amount}`,
    `tn=${encodeURIComponent(params.note)}`,
    'cu=INR',
  ].join('&');
  return `upi://pay?${query}`;
}

/** A warehouse's on-hand stock for a variant, in allocation priority order (lower priority first). */
export interface WarehouseStock {
  readonly warehouseId: string;
  readonly stock: number;
}

/**
 * Allocates a quantity across warehouses by priority, filling the highest-priority first.
 *
 * Returns the per-warehouse breakdown when the warehouses together hold enough, or null when they do
 * not — the caller turns null into an insufficient-stock refusal. Greedy over the list as given (the
 * caller passes it in priority order), taking as much as each warehouse holds until the quantity is
 * met, so a line ships from as few warehouses as possible. A warehouse contributing zero is omitted,
 * keeping the allocation map free of `0` entries the schema would reject.
 */
export function allocateStock(
  qty: number,
  warehouses: readonly WarehouseStock[],
): Record<string, number> | null {
  const allocation: Record<string, number> = {};
  let remaining = qty;

  for (const warehouse of warehouses) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, warehouse.stock);
    if (take > 0) {
      allocation[warehouse.warehouseId] = take;
      remaining -= take;
    }
  }

  return remaining > 0 ? null : allocation;
}

/**
 * The result of reserving units against an inventory record.
 *
 * A reservation moves nothing on-hand — it raises `reserved`, which is what `available =
 * onHandTotal - reserved` reads — so the only thing that can go wrong is reserving more than is
 * available. `ok: false` means exactly that, and the caller turns it into an insufficient-stock
 * refusal that fails the whole placement rather than overselling one line.
 */
export type ApplyReservationResult =
  { readonly ok: true; readonly reserved: number } | { readonly ok: false };

/**
 * Reserves `qty` units against a variant's inventory, returning the new `reserved` total or a
 * refusal.
 *
 * Available stock is `onHandTotal - reserved`; reserving is legal only when at least `qty` is
 * available, and it raises `reserved` by `qty` without touching on-hand — the units are held, not
 * moved. The on-hand decrement happens later, at payment commit. Refusing rather than clamping is
 * deliberate: a checkout that cannot fully reserve a line has to fail, because a partially reserved
 * order is one the customer did not agree to.
 */
export function applyReservation(
  inventory: { readonly onHandTotal: number; readonly reserved: number },
  qty: number,
): ApplyReservationResult {
  const available = inventory.onHandTotal - inventory.reserved;
  if (qty > available) return { ok: false };
  return { ok: true, reserved: inventory.reserved + qty };
}
