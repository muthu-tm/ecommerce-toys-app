import type { MediaItem, Money, ProductStatus, VariantSummary } from '@romp/contracts';
import { money, productStatusMachine } from '@romp/contracts';

/**
 * The pure logic behind a product write.
 *
 * None of this touches Firestore. It is the arithmetic and the rules that must give the
 * same answer wherever a product is written — the admin API today, a bulk importer later —
 * so the denormalised fields on `products/{id}` cannot drift from the variants they
 * summarise. The `@romp/data` write repository calls these and then persists the result in
 * one transaction; keeping the decisions here means they are unit-tested without an
 * emulator, which is where the invariants that protect a customer-facing price belong.
 */

/** A variant's price-bearing fields, the minimum this module needs to summarise it. */
export interface VariantForSummary {
  readonly variantId: string;
  readonly name: string;
  readonly sku: string;
  readonly priceMinor: Money;
  readonly mrpMinor: Money;
  readonly active: boolean;
  /** Availability is a boolean on the summary; the write path derives it from inventory. */
  readonly inStock: boolean;
}

export interface ProductPricing {
  readonly variantSummary: readonly VariantSummary[];
  /** The minimum selling price across active variants — the "from" price a card shows. */
  readonly priceFromMinor: Money;
  readonly mrpFromMinor: Money;
}

/**
 * Builds a product's denormalised pricing and variant summary from its variants.
 *
 * The "from" prices are the minimum across **active** variants, because an inactive variant
 * is not something a customer can buy and its price must not set the headline. When every
 * variant is inactive (a draft mid-edit) the minimum falls back across all variants, so the
 * fields are never zero for a product that has variants — a zero "from" price reads as free.
 *
 * The order of `variantSummary` follows the input, which the write path sorts by price, so
 * the summary a listing card reads matches the selector order on the detail page.
 */
export function summariseVariants(variants: readonly VariantForSummary[]): ProductPricing {
  const variantSummary: VariantSummary[] = variants.map((variant) => ({
    variantId: variant.variantId as VariantSummary['variantId'],
    name: variant.name,
    sku: variant.sku as VariantSummary['sku'],
    priceMinor: variant.priceMinor,
    mrpMinor: variant.mrpMinor,
    active: variant.active,
    inStock: variant.inStock,
  }));

  // Prefer active variants for the headline price; fall back to all variants so a
  // draft with only inactive variants still carries a non-zero "from".
  const pricingSet = variants.filter((variant) => variant.active);
  const forPricing = pricingSet.length > 0 ? pricingSet : variants;

  const priceFromMinor =
    forPricing.length === 0
      ? money(0)
      : money(Math.min(...forPricing.map((variant) => variant.priceMinor)));
  const mrpFromMinor =
    forPricing.length === 0
      ? money(0)
      : money(Math.min(...forPricing.map((variant) => variant.mrpMinor)));

  return { variantSummary, priceFromMinor, mrpFromMinor };
}

/**
 * Whether a product may be `active`: it needs at least one active variant.
 *
 * The `ProductDocSchema` refines this too, so a document that reached the state fails on
 * read — but the write path checks it up front to reject a publish with a clear error
 * rather than a schema failure deep in a converter.
 */
export function canBeActive(variants: readonly VariantForSummary[]): boolean {
  return variants.some((variant) => variant.active);
}

/**
 * Normalises media `order` to a contiguous `0..n-1` sequence, preserving relative order.
 *
 * `ProductDocSchema` requires unique order values (the cover — order 0 — cannot be
 * ambiguous), and an admin reordering images by drag should not have to renumber them by
 * hand. This sorts by the caller's intended order and rewrites the indices, so gaps and
 * duplicates a UI might produce become a clean sequence with a single cover.
 */
export function normaliseMediaOrder(media: readonly MediaItem[]): readonly MediaItem[] {
  return [...media]
    .sort((left, right) => left.order - right.order)
    .map((item, index) => ({ ...item, order: index }));
}

export interface StatusTransition {
  readonly status: ProductStatus;
  /**
   * The `publishedAt` to persist. Set to `now` when a product first reaches `active`;
   * otherwise the existing value is retained (a product returning to draft keeps the date
   * it was first published, so a re-publish does not look like a first publish).
   */
  readonly publishedAt: Date | null;
}

export type StatusTransitionResult =
  | { readonly ok: true; readonly transition: StatusTransition }
  | { readonly ok: false; readonly reason: string; readonly allowed: readonly ProductStatus[] };

/**
 * Resolves a status change against the product status machine and the publish-time rule.
 *
 * Rejects an illegal transition (e.g. `archived → active`, which must pass back through
 * `draft`) with the machine's own reason and the allowed targets, so the API can turn it
 * into a 409 that tells the operator what they can do instead. `publishedAt` is computed
 * here rather than in the repository so the "first publish stamps the date, later ones keep
 * it" rule lives beside the transition it depends on.
 */
export function resolveStatusTransition(
  from: ProductStatus,
  to: ProductStatus,
  currentPublishedAt: Date | null,
  now: Date,
): StatusTransitionResult {
  const check = productStatusMachine.check(from, to);
  if (!check.ok) {
    return { ok: false, reason: check.reason, allowed: check.allowed };
  }

  const publishedAt = to === 'active' && currentPublishedAt === null ? now : currentPublishedAt;
  return { ok: true, transition: { status: to, publishedAt } };
}

/**
 * The fields whose words feed the search index.
 *
 * Deliberately not the description: prefix-expanding five thousand characters makes every
 * product match almost anything (see `buildSearchTokens`). Name, brand, category and age
 * band are the discriminating text. Kept here so the admin write and the seed tokenise the
 * same fields — a product found by the seed's tokens must be found after an admin edit too.
 */
export function productSearchParts(input: {
  readonly name: string;
  readonly brand: string;
  readonly categoryName: string;
  readonly ageBandLabel: string;
}): readonly string[] {
  return [input.name, input.brand, input.categoryName, input.ageBandLabel];
}
