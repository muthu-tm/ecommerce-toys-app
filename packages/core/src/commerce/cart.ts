import { multiplyMoney, sumMoney, ZERO_MONEY } from '@romp/contracts';
import type { CartItem, Money } from '@romp/contracts';

/**
 * The pure logic behind a cart mutation.
 *
 * A cart is written through the API precisely so the browser cannot choose the price or the
 * quantity — this module is where those decisions actually live, kept pure so they are unit-tested
 * without an emulator. It takes the current lines, one mutation (add/set/remove), and the facts
 * the caller resolved from a fresh read — the variant still exists and is in stock, its current
 * price, how many units are available, the configured per-line ceiling — and returns the next set
 * of lines or a typed refusal. The `@romp/data` transaction is the shell that reads those facts,
 * calls this, and writes the result.
 *
 * Two ceilings apply and the lower wins: available stock (so a cart cannot promise units that do
 * not exist) and `maxQtyPerLine` (so a typo cannot park an absurd quantity regardless of stock). A
 * line's price snapshot is refreshed from the fresh variant on every mutation, so the cart renders
 * a current price — but the snapshot is display-only, and the charged amount comes from the
 * checkout quote, never from here.
 */

/** The variant facts resolved from a fresh read, used to build or refresh a line. */
export interface VariantSnapshot {
  readonly variantId: string;
  readonly productId: string;
  readonly sku: string;
  readonly priceMinor: Money;
  readonly nameSnapshot: string;
  readonly variantNameSnapshot: string;
  readonly imagePathSnapshot: string | null;
}

/** A cart mutation. `add` increments the existing line; `set` replaces its quantity; `remove` drops it. */
export type CartMutation =
  | { readonly kind: 'add'; readonly variantId: string; readonly qty: number }
  | { readonly kind: 'set'; readonly variantId: string; readonly qty: number }
  | { readonly kind: 'remove'; readonly variantId: string };

/** The facts a caller resolves before applying an add/set mutation. */
export interface CartMutationContext {
  /** The fresh variant, or null if it no longer exists or is not sellable. */
  readonly variant: VariantSnapshot | null;
  /** Units available to a new order right now (on-hand minus reserved). */
  readonly available: number;
  /** The store's per-line ceiling, independent of stock. */
  readonly maxQtyPerLine: number;
  /** The instant to stamp a new or changed line with. */
  readonly now: Date;
}

/**
 * Why a mutation was refused.
 *
 *  - `variant_unavailable`: the variant no longer exists, is not active, or has zero stock — a line
 *    a checkout could never fulfil.
 *  - `qty_exceeds_available`: the requested quantity is more than is in stock.
 *  - `qty_exceeds_max`: the requested quantity is above the per-line ceiling.
 */
export type CartMutationRefusal =
  'variant_unavailable' | 'qty_exceeds_available' | 'qty_exceeds_max';

export type ApplyCartMutationResult =
  | { readonly ok: true; readonly items: readonly CartItem[] }
  | { readonly ok: false; readonly reason: CartMutationRefusal };

/**
 * Applies a mutation to the cart's lines, returning the next lines or a typed refusal.
 *
 * `remove` always succeeds (removing an absent line is a no-op, which is what a client expects when
 * it clicks remove twice). `add` and `set` need `context.variant` and the ceilings: `add` sums the
 * requested quantity onto any existing line for that variant, `set` replaces it. Either way the
 * resulting quantity is checked against both ceilings, and the line's snapshots are refreshed from
 * the fresh variant. A variant appears at most once, matching the cart's schema invariant.
 */
export function applyCartMutation(
  items: readonly CartItem[],
  mutation: CartMutation,
  context: CartMutationContext,
): ApplyCartMutationResult {
  if (mutation.kind === 'remove') {
    return { ok: true, items: items.filter((item) => item.variantId !== mutation.variantId) };
  }

  const { variant, available, maxQtyPerLine, now } = context;
  if (variant === null || available <= 0) {
    return { ok: false, reason: 'variant_unavailable' };
  }

  const existing = items.find((item) => item.variantId === mutation.variantId);
  const nextQty = mutation.kind === 'add' ? (existing?.qty ?? 0) + mutation.qty : mutation.qty;

  if (nextQty > maxQtyPerLine) return { ok: false, reason: 'qty_exceeds_max' };
  if (nextQty > available) return { ok: false, reason: 'qty_exceeds_available' };

  const line: CartItem = {
    variantId: variant.variantId as CartItem['variantId'],
    productId: variant.productId as CartItem['productId'],
    sku: variant.sku as CartItem['sku'],
    qty: nextQty,
    priceMinorSnapshot: variant.priceMinor,
    nameSnapshot: variant.nameSnapshot,
    variantNameSnapshot: variant.variantNameSnapshot,
    imagePathSnapshot: variant.imagePathSnapshot,
    // Preserve the original added time on an update; stamp now on a first add.
    addedAt: existing?.addedAt ?? now,
  };

  const others = items.filter((item) => item.variantId !== mutation.variantId);
  return { ok: true, items: [...others, line] };
}

/** A cart line rendered for display: the snapshots plus a freshly computed line subtotal. */
export interface CartLineView {
  readonly item: CartItem;
  readonly lineSubtotalMinor: Money;
  /** Whether the variant is still in stock, refreshed on read. */
  readonly inStock: boolean;
}

/** The subtotal of a set of lines — quantity times price snapshot, summed. Display only. */
export function cartSubtotal(items: readonly CartItem[]): Money {
  if (items.length === 0) return ZERO_MONEY;
  return sumMoney(items.map((item) => multiplyMoney(item.priceMinorSnapshot, item.qty)));
}

/** Total unit count across all lines — what the header badge shows. */
export function cartItemCount(items: readonly CartItem[]): number {
  return items.reduce((total, item) => total + item.qty, 0);
}

/**
 * Merges an anonymous cart's lines into a user cart's lines, capping each merged quantity.
 *
 * On sign-in the guest's cart is folded into the account's. For a variant in both, the quantities
 * sum — but capped at the lower of available stock and the per-line ceiling, so the merge cannot
 * create a line that a fresh add would have refused. A variant only the guest had is added at its
 * quantity, likewise capped. The user cart's own snapshots win where both have the variant, since
 * they were the more recently rendered; the guest quantity is what is added.
 *
 * `availableByVariant` and `maxQtyPerLine` bound the result; a variant absent from the availability
 * map is treated as out of stock and dropped, because merging a line no checkout could fulfil is
 * worse than losing it.
 */
export function mergeCarts(
  userItems: readonly CartItem[],
  anonItems: readonly CartItem[],
  availableByVariant: ReadonlyMap<string, number>,
  maxQtyPerLine: number,
): readonly CartItem[] {
  const merged = new Map<string, CartItem>(userItems.map((item) => [item.variantId, item]));

  for (const anonItem of anonItems) {
    const available = availableByVariant.get(anonItem.variantId) ?? 0;
    if (available <= 0) continue;

    const existing = merged.get(anonItem.variantId);
    const summed = (existing?.qty ?? 0) + anonItem.qty;
    const qty = Math.min(summed, available, maxQtyPerLine);
    if (qty <= 0) continue;

    // Keep the user cart's snapshots when it already had the line; otherwise take the guest's.
    const base = existing ?? anonItem;
    merged.set(anonItem.variantId, { ...base, qty });
  }

  return [...merged.values()];
}
