import { z } from 'zod';

import { BasisPointsSchema } from './basis-points';
import type { BasisPoints } from './basis-points';

/**
 * Money — an integer count of the currency's minor unit (paise for INR).
 *
 * Never a float, never a formatted string. The reasoning is in
 * ADR-0004, but the short version is that the amount we compute is the amount a
 * human compares to a bank statement: payments are manually verified UPI
 * transfers, so a half-paise rounding difference is not cosmetic, it is an order
 * that cannot be reconciled.
 *
 * The brand means a raw `number` does not satisfy `Money`, so a float cannot
 * reach a money field by accident. TypeScript brands are erased at runtime, so
 * the schema — not the type — is what enforces integrality on data crossing a
 * boundary.
 */
export const MoneySchema = z
  .int({ error: 'Money must be an integer number of paise, not a decimal amount.' })
  .nonnegative({ error: 'Money cannot be negative.' })
  .brand<'Money'>();

export type Money = z.infer<typeof MoneySchema>;

/**
 * A signed monetary delta. Refund adjustments and ledger corrections legitimately
 * go both ways; `Money` itself stays non-negative so a negative price or a
 * negative order total remains unrepresentable.
 */
export const MoneyDeltaSchema = z
  .int({ error: 'A money delta must be an integer number of paise.' })
  .brand<'MoneyDelta'>();

export type MoneyDelta = z.infer<typeof MoneyDeltaSchema>;

/** The zero amount, pre-validated. */
export const ZERO_MONEY = MoneySchema.parse(0);

/**
 * Constructs a `Money` from an integer paise value, throwing on anything else.
 *
 * Use at trusted construction sites — literals, arithmetic results, seed data.
 * For untrusted input use `MoneySchema.safeParse`, which yields an error you can
 * turn into a field-level validation message.
 */
export function money(paise: number): Money {
  return MoneySchema.parse(paise);
}

/** Constructs a signed `MoneyDelta`. */
export function moneyDelta(paise: number): MoneyDelta {
  return MoneyDeltaSchema.parse(paise);
}

/**
 * Converts a rupee amount to `Money`.
 *
 * Only for boundaries that genuinely deal in rupees — an admin typing a price, a
 * CSV import. Rounds to the nearest paise because `199.999` is a data-entry
 * error, not an amount, and silently truncating it would understate a price.
 */
export function rupeesToMoney(rupees: number): Money {
  if (!Number.isFinite(rupees)) {
    throw new TypeError(`Cannot convert ${String(rupees)} rupees to money.`);
  }
  return money(Math.round(rupees * 100));
}

/**
 * Converts `Money` to a rupee number.
 *
 * For display and for the UPI QR amount field only. The result is a float, so it
 * must never re-enter a calculation.
 */
export function moneyToRupees(amount: Money): number {
  return amount / 100;
}

export function addMoney(...amounts: readonly Money[]): Money {
  return money(amounts.reduce<number>((total, amount) => total + amount, 0));
}

/** Alias for `addMoney` over a list — reads better at call sites summing lines. */
export function sumMoney(amounts: readonly Money[]): Money {
  return addMoney(...amounts);
}

/**
 * Subtracts and refuses to go negative.
 *
 * Throws rather than clamping: an amount that wants to be negative is a bug in
 * the caller — a refund exceeding the refundable balance, a discount larger than
 * the subtotal — and clamping to zero would hide it while quietly giving money
 * away.
 */
export function subtractMoney(minuend: Money, subtrahend: Money): Money {
  const result = minuend - subtrahend;
  if (result < 0) {
    throw new RangeError(
      `Money subtraction would be negative: ${String(minuend)} - ${String(subtrahend)}. Check the caller's invariant rather than clamping.`,
    );
  }
  return money(result);
}

/** Multiplies by a non-negative integer quantity. */
export function multiplyMoney(amount: Money, quantity: number): Money {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new RangeError(`Quantity must be a non-negative integer, got ${String(quantity)}.`);
  }
  return money(amount * quantity);
}

/**
 * Applies a tax or fee rate expressed in basis points.
 *
 * Integer multiply, integer divide, one explicit rounding step — half-up. With a
 * float rate like `0.18` there would be two floating-point values in the
 * expression and the rounding would happen wherever the double landed.
 */
export function applyTaxBps(amount: Money, rate: BasisPoints): Money {
  BasisPointsSchema.parse(rate);
  return money(Math.round((amount * rate) / 10_000));
}

/** The amount plus its tax at `rate`. */
export function addTaxBps(amount: Money, rate: BasisPoints): Money {
  return addMoney(amount, applyTaxBps(amount, rate));
}

/**
 * Splits `total` across `weights` so the parts sum **exactly** to the total.
 *
 * Naive division loses paise, and the lost paise surface as an order whose total
 * does not equal the sum of its lines. Uses largest-remainder: floor every share,
 * then hand the remaining paise to the entries with the biggest discarded
 * fractions, ties broken by position so the result is deterministic.
 *
 * Used for distributing an order-level discount or shipping charge across lines.
 */
export function allocateProportionally(total: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) {
    throw new RangeError('Cannot allocate across an empty set of weights.');
  }
  if (weights.some((weight) => !Number.isFinite(weight) || weight < 0)) {
    throw new RangeError('Allocation weights must be finite and non-negative.');
  }

  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);

  // No signal to allocate on. Spreading evenly is the only defensible choice, and
  // it still has to sum exactly, so it goes through the same remainder pass.
  const shares =
    weightTotal === 0
      ? weights.map(() => total / weights.length)
      : weights.map((weight) => (total * weight) / weightTotal);

  const floors = shares.map((share) => Math.floor(share));
  const allocated = floors.reduce((sum, share) => sum + share, 0);
  let remainder = total - allocated;

  const byLargestFraction = shares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);

  const result = [...floors];
  for (const { index } of byLargestFraction) {
    if (remainder <= 0) break;
    result[index] = (result[index] ?? 0) + 1;
    remainder -= 1;
  }

  return result.map((paise) => money(paise));
}

/**
 * Formats `Money` for display.
 *
 * One implementation, called only at edges — a UI component, a WhatsApp message,
 * an invoice. A formatted string must never travel back into a calculation or
 * into Firestore.
 *
 * ADR-0004 placed this in the UI layer; it lives here instead so that the API,
 * which also renders customer-facing copy, does not need a second copy of it.
 */
export function formatMoney(
  amount: Money,
  options: { readonly locale: string; readonly currency: string },
): string {
  return new Intl.NumberFormat(options.locale, {
    style: 'currency',
    currency: options.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(moneyToRupees(amount));
}
