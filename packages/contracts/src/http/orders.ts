import { z } from 'zod';

import { DeliverySpeedSchema, OrderStatusSchema } from '../domain/order';
import { PostalAddressSchema } from '../entities/common';
import {
  OrderAmountsSchema,
  OrderFulfilmentSchema,
  OrderItemSchema,
  OrderPaymentSchema,
} from '../entities/order';
import { HumanOrderIdSchema } from '../primitives/identifiers';
import { AddressIdSchema, OrderIdSchema } from '../primitives/ids';
import { InstantSchema } from '../primitives/instant';

/**
 * The order wire contracts.
 *
 * Placing an order is the one write in the platform that both moves money into play and takes stock
 * out of it, so the request is deliberately thin: an address the caller already owns, a delivery
 * speed, and the gift choices. Everything priced — the lines, every total, the UPI payload — is
 * produced by the server from the caller's own cart inside a single transaction, and echoed back so
 * the confirmation page can render the QR without a second round trip.
 */

/**
 * Place the caller's cart as an order.
 *
 * The cart is not on the wire — it is the caller's own, resolved by uid on the server, so a client
 * cannot place an order for a basket it constructed. `addressId` is one of the caller's saved
 * addresses; the server snapshots it onto the order. `giftMessage` is only meaningful when `isGift`
 * is set, but it is accepted independently and simply ignored otherwise rather than rejected, so a
 * customer toggling the gift flag off does not lose what they typed.
 */
export const PlaceOrderRequestSchema = z.object({
  addressId: AddressIdSchema,
  deliverySpeed: DeliverySpeedSchema,
  isGift: z.boolean(),
  giftMessage: z.string().max(500).nullable(),
});
export type PlaceOrderRequest = z.infer<typeof PlaceOrderRequestSchema>;

/**
 * The result of placing an order.
 *
 * `orderId` is the random document ID the confirmation page navigates to; `humanId` is the
 * sequential number the customer quotes when they message about payment. `qrPayload` is the exact
 * UPI intent string — amount and reference fixed — that the page renders as a QR, so the customer
 * pays the precise total against the right order. `amounts` is the authoritative breakdown the
 * transaction committed.
 */
export const PlaceOrderResponseSchema = z.object({
  orderId: OrderIdSchema,
  humanId: HumanOrderIdSchema,
  qrPayload: z.string().min(1).max(2_048),
  amounts: OrderAmountsSchema,
  status: OrderStatusSchema,
});
export type PlaceOrderResponse = z.infer<typeof PlaceOrderResponseSchema>;

/**
 * An order as the customer views it — the response of `GET /v1/orders/:id`.
 *
 * This is the customer's own record: the immutable line snapshots, the committed amounts, the
 * shipping address they chose, and the payment block that carries the QR payload and — once they
 * submit a UTR — the reference and its verification state. It is a projection of the stored order
 * document restricted to what a customer may see; staff-only fields (the internal hold reason lives
 * on fulfilment and is surfaced to staff elsewhere) are not stripped here because the customer owns
 * the whole of their own order, but the store-wide event spine and other customers' orders are
 * never reachable through this shape.
 */
export const OrderViewSchema = z.object({
  orderId: OrderIdSchema,
  humanId: HumanOrderIdSchema,
  status: OrderStatusSchema,
  fulfilment: OrderFulfilmentSchema,
  items: z.array(OrderItemSchema).min(1),
  amounts: OrderAmountsSchema,
  shippingAddress: PostalAddressSchema,
  deliverySpeed: DeliverySpeedSchema,
  isGift: z.boolean(),
  giftMessage: z.string().max(500).nullable(),
  payment: OrderPaymentSchema,
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type OrderView = z.infer<typeof OrderViewSchema>;

/**
 * The customer's order history — the response of `GET /v1/orders`.
 *
 * Their own orders, newest first, each the same `OrderView` the detail page renders, so the history
 * list and a single order never disagree about a status or a total. Wrapped in an object rather than
 * a bare array so the shape can grow a cursor later without a breaking change.
 */
export const OrderListResponseSchema = z.object({
  orders: z.array(OrderViewSchema),
});
export type OrderListResponse = z.infer<typeof OrderListResponseSchema>;
