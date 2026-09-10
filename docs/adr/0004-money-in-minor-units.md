# ADR-0004 — All money is integer minor units; tax rates are basis points

- **Status** — Accepted
- **Date** — 2026-09-09
- **Deciders** — Platform
- **Supersedes** — none

## Context

The platform computes prices, discounts, GST, shipping, order totals and refunds, then encodes an exact
amount into a UPI QR code that a customer pays and an admin verifies against a bank statement.

That last sentence is the whole context. Because there is no payment gateway
([ADR-0007](0007-notifications-not-email.md) covers the communication side; the payment side is
manual by product decision), **the number we compute is the number a human compares to a bank
statement**. A half-paise rounding difference is not a cosmetic bug — it is an order that cannot be
verified, a customer whose payment appears wrong, and an admin making a judgement call the system was
supposed to remove.

JavaScript has one numeric type, IEEE-754 double. It cannot represent `0.1` exactly. The canonical
demonstration:

```js
0.1 + 0.2; // 0.30000000000000004
1699.99 * 3; // 5099.969999999999
(0.07 * 100).toFixed(0); // "7"  — but 0.07 * 100 is 7.000000000000001
```

Firestore stores numbers as doubles, so the problem is not only in memory — it is in the database.
Errors accumulate across line items, tax lines and shipping, and they accumulate differently depending
on the order of operations, which means two code paths computing "the same" total can disagree.

GST adds a second dimension. Indian rates are 0%, 5%, 12%, 18% and 28%. A rate stored as `0.18` is a
float, and multiplying a float rate by a float price compounds two representation errors.

## Decision

**Every monetary value is a non-negative integer in the currency's minor unit — paise for INR — stored
in a field whose name ends in `Minor`. Every tax rate is an integer in basis points.**

```ts
// @romp/contracts
type Money = number & { readonly __brand: 'Money' }; // integer paise
type BasisPoints = number & { readonly __brand: 'BasisPoints' }; // 1800 = 18%

interface OrderLine {
  unitPriceMinor: Money; // 169999 = ₹1,699.99
  quantity: number;
  lineTotalMinor: Money;
  taxRateBps: BasisPoints; // 1800
  taxMinor: Money;
}
```

The rules that make this hold in practice:

1. **The `Minor` suffix is the contract.** A field ending in `Minor` is an integer count of paise —
   never a float, never a formatted string, never a rupee value. Reading a field name tells you the
   unit, so no code has to guess.
2. **`Money` is a branded type constructed only through validated helpers.** A raw `number` does not
   satisfy `Money`, so a float cannot reach a money field by accident. The Zod schema rejects
   non-integers and negatives at every boundary, including Firestore converter output — so legacy or
   hand-edited data cannot slip through either.
3. **Arithmetic lives in `@romp/core`, never inline.** `addMoney`, `multiplyMoney`,
   `applyTaxBps`, `allocateProportionally`. Inline `a + b` on two `Money` values happens to work, but
   inline `price * 0.18` does not, and the only reliable way to prevent the second is to route all of it
   through named functions.
4. **Rounding is explicit and stated at the call site.** `applyTaxBps` rounds half-up to the nearest
   paise, and that choice is written down rather than inherited from whatever `Math.round` does with
   negative numbers.
5. **Division allocates, it does not divide.** Splitting a discount across three lines uses
   `allocateProportionally`, which distributes the remainder deterministically (largest-remainder) so the
   parts sum exactly to the whole. Naive division loses paise, and the lost paise show up as a total that
   does not equal the sum of its lines.
6. **Formatting happens once, at the very edge.** `formatMoney(value, locale, currency)` in the UI
   layer. A formatted string never travels back into a computation, and never lands in Firestore.
7. **The QR amount comes from `order.totalMinor`, converted at the last moment.** One conversion, one
   source. Verification then compares two integers.

### Why basis points rather than a decimal rate

`18%` is `1800` bps. `applyTaxBps(amount, bps)` is `round(amount * bps / 10000)` — integer multiply,
integer divide, one explicit rounding step. With a `0.18` float there are two floats in the expression
and rounding is wherever the double happens to land.

## Alternatives considered

### A. Floating-point rupees

The obvious default. `price: 1699.99`. Readable in the Firestore console, no conversion in the UI.

Rejected. This is the mistake the whole ADR exists to prevent. It is not a theoretical risk: totals that
disagree with the sum of their lines, refunds off by a paise, and — worst here — a QR amount that does
not match what verification expects. Manual verification makes every one of those a support ticket
rather than a log line.

### B. Store rupees as a string, parse on use

`"1699.99"`. Exact in storage, unambiguous to read.

Rejected because it moves the problem rather than solving it. Every computation still needs parsing to
_something_, and if that something is a double we are back to option A with extra steps. It also breaks
Firestore range queries and ordering — `priceMinor` is the one range field the listing page has
([ADR-0002](0002-firestore-search-port.md)), and string ordering would sort `"999.00"` above
`"1699.99"`.

### C. A decimal library — decimal.js, big.js

Correct arbitrary-precision arithmetic, familiar API, handles division cleanly.

Rejected for v1.0, and it was the closest call. Reasons: Firestore has no decimal type, so values still
serialise to a number or a string and we inherit whichever problem that brings; every read and write
needs conversion, so the boundary discipline is the same amount of work as integers; it adds bundle
weight to a client where LCP is a gate; and a `Decimal` instance is not JSON, so it cannot cross the
HTTP boundary without a codec.

The deciding argument: with a single currency whose minor unit is 1/100, integers are exactly as correct
as decimals and require no library, no serialisation codec, and no bundle. A decimal library earns its
place when you need fractional minor units — per-unit costs at four decimal places, or currency
conversion. We have neither. If that changes, the `Money` brand and the arithmetic helpers are the seam:
their internals change, their call sites do not.

### D. Integer minor units — chosen

## Consequences

### Good

- Money arithmetic is exact. A total always equals the sum of its lines, because there is no place for a
  fraction to hide.
- The QR amount, the order total and the verification comparison are the same integer. Verification is
  an equality check, which is what makes the manual payment flow mechanical rather than a judgement
  call.
- Firestore range queries and ordering on `priceMinor` work naturally, which the listing page depends on.
- The branded type turns a whole class of bug into a compile error. Passing a raw `number` where `Money`
  is expected does not build.
- Rounding is visible. Every rounding decision is a named function call, so a rounding question has one
  place to look and one place to test.
- Tax is auditable: `taxRateBps` and `taxMinor` are both stored on the line, so a historical order can be
  re-verified even after rates change.

### Bad, and accepted

- **Every boundary needs conversion.** UI display, UPI QR generation, CSV export, WhatsApp message
  copy. Forget one and a customer sees `₹169999`. Mitigated by a single `formatMoney` helper and by the
  fact that the error is glaring rather than subtle — an off-by-100 display bug gets reported in
  minutes; a floating-point bug can hide for months. That asymmetry is the point.
- **Firestore documents are less readable.** `totalMinor: 384998` requires mental arithmetic when
  debugging in the console. Accepted; the admin UI formats correctly.
- **`Money` is a branded number, not a nominal type.** TypeScript brands are erased at runtime, so
  discipline at the boundary — Zod parsing — is what actually enforces integrality. The brand catches
  developer mistakes; the schema catches data.
- **No support for fractional paise.** If a future feature needs per-unit pricing at four decimals, this
  representation is insufficient and the arithmetic helpers change.
- **A second currency with a different minor-unit exponent** (Kuwaiti dinar is 1/1000, Japanese yen is
  1/1) means `Minor` alone stops being self-describing and needs a currency code alongside it. The
  white-label config already carries a currency, so the seam exists, but the helpers would need the
  exponent threaded through.
- Reviewers must know the convention. A new contributor's instinct is to write `price: 1699.99`. The
  branded type stops it, but it is a thing to explain, which is why it is in the README's standards
  list.

## Related

- [`DATA_MODEL.md`](../DATA_MODEL.md) — every `*Minor` field
- [`README.md § engineering standards`](../../README.md#engineering-standards)
- Task 3 — where `Money`, `BasisPoints` and the arithmetic helpers are implemented and tested at the
  domain coverage tier
