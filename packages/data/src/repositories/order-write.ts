import { randomUUID } from 'node:crypto';

import type {
  CartDoc,
  CheckoutSettingsDoc,
  EventDoc,
  InventoryDoc,
  OrderDoc,
  OrderEventDoc,
  OrderItem,
  PostalAddress,
  ReservationDoc,
  ReservationItem,
} from '@romp/contracts';
import {
  allocateStock,
  applyReservation,
  buildUpiUri,
  computeOrderTotals,
  formatOrderNumber,
} from '@romp/core';
import { InsufficientStockError } from '@romp/observability';

import type { Caller, StoreContext } from '../context';
import { actorIdOf, asSystem } from '../context';
import { converters } from '../converters';
import { COLLECTIONS, paths } from '../paths';

import { findAddress } from './accounts';
import { findProductById, listAllocatableWarehouses } from './catalogue';
import { appendEventInTransaction } from './events';

/**
 * Order placement — the money-critical transaction.
 *
 * Placing an order does five things that must all commit together or not at all: recompute the
 * totals from the *live* variant prices (never the cart's display snapshots), reserve stock across
 * warehouses by priority, allocate the next sequential order number, write the order and its
 * reservation and audit events, and clear the cart. It is one Firestore transaction so concurrent
 * checkouts serialise on the same one-document-per-variant inventory records: the oversell invariant
 * is what makes N parallel checkouts for a single remaining unit resolve to exactly one success.
 *
 * Totals are server-authoritative. The pure arithmetic is `@romp/core`'s `computeOrderTotals`, the
 * same function the quote route calls, so what a customer was quoted and what the order records
 * cannot drift — and a tampered client value has nowhere to enter. The UPI intent string is minted
 * here with the exact total and the order number, which is what turns Task 17's manual verification
 * into a two-field match.
 */

/** What the caller supplies to place an order; the repo resolves the rest server-side. */
export interface PlaceOrderInput {
  readonly uid: string;
  readonly addressId: string;
  readonly deliverySpeed: 'standard' | 'express';
  readonly isGift: boolean;
  readonly giftMessage: string | null;
  /** Contact snapshot for the order, from the account. */
  readonly contact: { readonly email: string | null; readonly phone: string | null };
}

/** Raised when placement is attempted with an empty (or missing) cart. */
export class EmptyCartError extends Error {
  constructor() {
    super('Cannot place an order from an empty cart.');
    this.name = 'EmptyCartError';
  }
}

/** Raised when a cart line references a variant that is no longer sellable. */
export class VariantUnavailableError extends Error {
  readonly variantId: string;
  constructor(variantId: string) {
    super(`Variant "${variantId}" is no longer available.`);
    this.name = 'VariantUnavailableError';
    this.variantId = variantId;
  }
}

/** A cart line resolved to its live price and product/variant snapshot, ready to order. */
interface ResolvedLine {
  readonly variantId: string;
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly variantName: string;
  readonly imagePath: string | null;
  readonly unitPriceMinor: OrderItem['unitPriceMinor'];
  readonly qty: number;
}

/**
 * Resolves a cart's lines to their live prices and snapshots, refusing any variant gone since it was
 * added. Reads as the customer would see the catalogue (only active, public products/variants), so a
 * line pointing at a since-archived product fails placement rather than ordering something unlisted.
 */
async function resolveLines(ctx: StoreContext, cart: CartDoc): Promise<readonly ResolvedLine[]> {
  return Promise.all(
    cart.items.map(async (item): Promise<ResolvedLine> => {
      const product = await findProductById(ctx, ANONYMOUS_FOR_CATALOGUE, item.productId);
      const variantSnap = await ctx.db
        .doc(paths.variant(item.productId, item.variantId))
        .withConverter(converters.variants)
        .get();
      const variant = variantSnap.data();
      if (product === null || !variant?.active) {
        throw new VariantUnavailableError(item.variantId);
      }
      return {
        variantId: item.variantId,
        productId: item.productId,
        sku: variant.sku,
        name: product.name,
        variantName: variant.name,
        imagePath: product.media[0]?.path ?? null,
        unitPriceMinor: variant.priceMinor,
        qty: item.qty,
      };
    }),
  );
}

// The catalogue reads use the anonymous caller so only active/public products resolve — a customer
// cannot order a draft. Imported lazily to avoid a circular import at module load.
const ANONYMOUS_FOR_CATALOGUE = { kind: 'anonymous' } as Caller;

/** One priced quote line: the live snapshot plus the recomputed line total. */
export interface QuoteLine {
  readonly variantId: string;
  readonly productId: string;
  readonly name: string;
  readonly variantName: string;
  readonly unitPriceMinor: OrderItem['unitPriceMinor'];
  readonly qty: number;
  readonly lineTotalMinor: OrderItem['lineTotalMinor'];
}

/** A read-only quote of the caller's cart at the live prices, for the checkout page. */
export interface QuoteResult {
  readonly lines: readonly QuoteLine[];
  readonly giftWrap: boolean;
  readonly totals: ReturnType<typeof computeOrderTotals>;
}

/**
 * Prices the caller's cart at the live variant prices — the checkout quote.
 *
 * This is the read-only twin of `reserveAndPlaceOrder`'s pricing: it resolves the same lines through
 * the same `resolveLines` and runs the same `computeOrderTotals`, so a quote the customer sees and
 * the order they place cannot disagree. It reserves no stock and writes nothing — it is a preview,
 * recomputed authoritatively again at placement. An empty (or missing) cart is an `EmptyCartError`,
 * because there is nothing to quote.
 */
export async function quoteCart(
  ctx: StoreContext,
  uid: string,
  deliverySpeed: 'standard' | 'express',
  settings: CheckoutSettingsDoc,
): Promise<QuoteResult> {
  const cart = (await ctx.db.doc(paths.cart(uid)).withConverter(converters.carts).get()).data();
  if (cart === undefined || cart.items.length === 0) throw new EmptyCartError();

  const lines = await resolveLines(ctx, cart);
  const totals = computeOrderTotals(
    lines.map((line) => ({ unitPriceMinor: line.unitPriceMinor, qty: line.qty })),
    { giftWrap: cart.giftWrap, deliverySpeed },
    settings,
  );

  return {
    lines: lines.map((line) => ({
      variantId: line.variantId,
      productId: line.productId,
      name: line.name,
      variantName: line.variantName,
      unitPriceMinor: line.unitPriceMinor,
      qty: line.qty,
      lineTotalMinor: (line.unitPriceMinor * line.qty) as OrderItem['lineTotalMinor'],
    })),
    giftWrap: cart.giftWrap,
    totals,
  };
}

export interface PlaceOrderResult {
  readonly orderId: string;
  readonly humanId: string;
  readonly qrPayload: string;
  readonly amounts: OrderDoc['amounts'];
  readonly status: OrderDoc['status'];
}

/**
 * Reserves stock and places an order in one transaction.
 *
 * The heavy reads — the cart, the address, the warehouses, and each line's live variant — happen
 * before the transaction, because they do not need serialising. The transaction reads only what it
 * must serialise on: every line's inventory document and the order-number counter. Inside it, each
 * line is reserved (raising `reserved`, refusing an oversell), allocated across warehouses by
 * priority, the counter is incremented to mint the human order number, and the order, its
 * reservation, its audit event, the spine `order.created` event, and the emptied cart are all
 * written. A refusal — empty cart, a vanished variant, insufficient stock — throws having written
 * nothing.
 */
export async function reserveAndPlaceOrder(
  ctx: StoreContext,
  caller: Caller,
  input: PlaceOrderInput,
  settings: CheckoutSettingsDoc,
  orderPrefix: string,
): Promise<PlaceOrderResult> {
  const now = ctx.clock.now();

  const cart = (
    await ctx.db.doc(paths.cart(input.uid)).withConverter(converters.carts).get()
  ).data();
  if (cart === undefined || cart.items.length === 0) throw new EmptyCartError();

  // Address (404 if gone), warehouses (allocation priority), and each line's live price/snapshot.
  const address = await findAddress(ctx, caller, input.uid, input.addressId);
  // Warehouses are staff-only reads, but placement legitimately needs the allocation order — the
  // system caller is the server acting on the customer's behalf, the same way the reservation reads
  // inventory counts the customer-facing API hides.
  const warehouses = await listAllocatableWarehouses(ctx, asSystem('order placement'));
  const lines = await resolveLines(ctx, cart);

  const totals = computeOrderTotals(
    lines.map((line) => ({ unitPriceMinor: line.unitPriceMinor, qty: line.qty })),
    { giftWrap: cart.giftWrap, deliverySpeed: input.deliverySpeed },
    settings,
  );

  const orderRef = ctx.db.collection(COLLECTIONS.orders).withConverter(converters.orders).doc();
  const reservationRef = ctx.db
    .collection(COLLECTIONS.reservations)
    .withConverter(converters.reservations)
    .doc();
  const counterRef = ctx.db.doc(paths.orderHumanIdCounter()).withConverter(converters.counters);
  const cartRef = ctx.db.doc(paths.cart(input.uid)).withConverter(converters.carts);

  const shippingAddress: PostalAddress = {
    recipientName: address.recipientName,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    phone: address.phone,
  };

  const result = await ctx.db.runTransaction(async (tx) => {
    // --- all reads first: pair each line with its inventory ref and snapshot ---
    const lineReads = await Promise.all(
      lines.map(async (line) => {
        const ref = ctx.db.doc(paths.inventory(line.variantId)).withConverter(converters.inventory);
        const snap = await tx.get(ref);
        return { line, ref, inventory: snap.data() };
      }),
    );
    const counterSnap = await tx.get(counterRef);

    // --- reserve + allocate each line (pure decisions) ---
    const orderItems: OrderItem[] = [];
    const reservationItems: ReservationItem[] = [];
    const allocation: Record<string, Record<string, number>> = {};
    const inventoryWrites: { ref: (typeof lineReads)[number]['ref']; next: InventoryDoc }[] = [];

    for (const { line, ref, inventory } of lineReads) {
      // A variant with no inventory document has no stock at all — refuse before reserving, which
      // also means `inventory` is defined for the write below.
      if (inventory === undefined) {
        throw new InsufficientStockError({ sku: line.sku, requested: line.qty, available: 0 });
      }
      const { onHandTotal, reserved } = inventory;

      const reservation = applyReservation({ onHandTotal, reserved }, line.qty);
      if (!reservation.ok) {
        throw new InsufficientStockError({
          sku: line.sku,
          requested: line.qty,
          available: onHandTotal - reserved,
        });
      }

      const perWarehouse = allocateStock(
        line.qty,
        warehouses.map((warehouse) => ({
          warehouseId: warehouse.code,
          stock: inventory.stock[warehouse.code] ?? 0,
        })),
      );
      if (perWarehouse === null) {
        throw new InsufficientStockError({
          sku: line.sku,
          requested: line.qty,
          available: onHandTotal - reserved,
        });
      }

      orderItems.push({
        productId: line.productId as OrderItem['productId'],
        variantId: line.variantId as OrderItem['variantId'],
        sku: line.sku as OrderItem['sku'],
        name: line.name,
        variantName: line.variantName,
        imagePath: line.imagePath,
        unitPriceMinor: line.unitPriceMinor,
        qty: line.qty,
        lineTotalMinor: (line.unitPriceMinor * line.qty) as OrderItem['lineTotalMinor'],
      });
      reservationItems.push({
        variantId: line.variantId as ReservationItem['variantId'],
        qty: line.qty,
        allocation: perWarehouse,
      });
      allocation[line.variantId] = perWarehouse;

      inventoryWrites.push({
        ref,
        next: { ...inventory, reserved: reservation.reserved, updatedAt: now },
      });
    }

    // --- mint the sequential human order number ---
    const nextCounterValue = (counterSnap.data()?.value ?? 0) + 1;
    const humanId = formatOrderNumber(orderPrefix, nextCounterValue);

    const qrPayload = buildUpiUri({
      vpa: settings.upi.vpa,
      payeeName: settings.upi.payeeName,
      amountMinor: totals.totalMinor,
      note: humanId,
    });

    const order: OrderDoc = {
      humanId: humanId as OrderDoc['humanId'],
      userId: input.uid as OrderDoc['userId'],
      contact: {
        email: input.contact.email as OrderDoc['contact']['email'],
        phone: input.contact.phone as OrderDoc['contact']['phone'],
      },
      status: 'awaiting_payment',
      fulfilment: {
        status: 'unfulfilled',
        carrier: null,
        trackingNo: null,
        packedAt: null,
        shippedAt: null,
        deliveredAt: null,
        holdReason: null,
      },
      items: orderItems,
      amounts: { ...totals, refundedMinor: 0 as OrderDoc['amounts']['refundedMinor'] },
      shippingAddress,
      deliverySpeed: input.deliverySpeed,
      isGift: input.isGift,
      giftMessage: input.giftMessage,
      payment: {
        method: 'upi',
        upiRef: null,
        screenshotPath: null,
        qrPayload,
        submittedAt: null,
        verifiedBy: null,
        verifiedAt: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
      },
      reservationId: reservationRef.id as OrderDoc['reservationId'],
      allocation: allocation,
      createdAt: now,
      updatedAt: now,
    };

    const reservation: ReservationDoc = {
      orderId: orderRef.id as ReservationDoc['orderId'],
      items: reservationItems,
      status: 'active',
      expiresAt: new Date(now.getTime() + settings.reservationTtlMinutes * 60 * 1000),
      createdAt: now,
      resolvedAt: null,
    };

    const orderEvent: OrderEventDoc = {
      orderId: orderRef.id as OrderEventDoc['orderId'],
      type: 'order.created',
      actorId: actorIdOf(caller) as OrderEventDoc['actorId'],
      actorRole: 'customer',
      payload: { humanId, totalMinor: totals.totalMinor },
      at: now,
    };

    const spineEvent: EventDoc = {
      type: 'order.created',
      actorId: actorIdOf(caller) as EventDoc['actorId'],
      subject: { kind: 'order', id: orderRef.id },
      payload: {
        type: 'order.created',
        orderId: orderRef.id as never,
        humanId: humanId as never,
        userId: input.uid as never,
        totalMinor: totals.totalMinor,
        itemCount: orderItems.reduce((total, item) => total + item.qty, 0),
      },
      at: now,
    };

    // --- all writes ---
    for (const write of inventoryWrites) {
      tx.set(write.ref, write.next);
    }
    tx.set(counterRef, { value: nextCounterValue, updatedAt: now });
    tx.set(orderRef, order);
    tx.set(reservationRef, reservation);
    tx.set(
      ctx.db.doc(paths.orderEvent(orderRef.id, randomUUID())).withConverter(converters.orderEvents),
      orderEvent,
    );
    appendEventInTransaction(tx, ctx, spineEvent);
    tx.set(cartRef, { ...cart, items: [], updatedAt: now });

    return {
      orderId: orderRef.id,
      humanId,
      qrPayload,
      amounts: order.amounts,
      status: order.status,
    };
  });

  return result;
}
