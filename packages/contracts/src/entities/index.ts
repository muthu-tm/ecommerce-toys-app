/**
 * Firestore document schemas — one per collection in `docs/DATA_MODEL.md`.
 *
 * These describe documents **as decoded**: instants are `Date`, money is an
 * integer count of paise, and every identifier is branded. The Firestore
 * representation (`Timestamp`) is the converters' problem, in `@romp/data`, so
 * that this package stays importable from the browser bundle.
 *
 * Cross-document invariants are **not** here. A schema sees one document, so
 * "exactly one default address per user" or "stock never goes negative across a
 * reservation" cannot be expressed; those live in the transactions that write
 * them. What is here is every invariant a single document can violate on its own —
 * a subtotal that does not match its lines, a paid order with no verifying admin,
 * an inventory total that disagrees with its per-warehouse map. Those fail on read
 * as well as on write, so a document corrupted by any path is caught the next time
 * anything looks at it.
 */

export { AuditTimestampsSchema, MediaItemSchema, PostalAddressSchema, SeoSchema } from './common';
export type { MediaItem, PostalAddress, Seo } from './common';

export {
  PUBLIC_PRODUCT_STATUS,
  CategoryDocSchema,
  ProductDocSchema,
  ProductSafetySchema,
  VariantDocSchema,
  VariantSummarySchema,
} from './product';
export type { CategoryDoc, ProductDoc, ProductSafety, VariantDoc, VariantSummary } from './product';

export {
  InventoryDocSchema,
  InventoryLedgerDocSchema,
  ReservationDocSchema,
  ReservationItemSchema,
  WarehouseDocSchema,
} from './inventory';
export type {
  InventoryDoc,
  InventoryLedgerDoc,
  ReservationDoc,
  ReservationItem,
  WarehouseDoc,
} from './inventory';

export {
  AddressDocSchema,
  IdentityIndexDocSchema,
  UserDocSchema,
  WishlistItemDocSchema,
} from './user';
export type { AddressDoc, IdentityIndexDoc, UserDoc, WishlistItemDoc } from './user';

export { CartDocSchema, CartItemSchema } from './cart';
export type { CartDoc, CartItem } from './cart';

export {
  CounterDocSchema,
  OrderAmountsSchema,
  OrderDocSchema,
  OrderEventDocSchema,
  OrderFulfilmentSchema,
  OrderItemSchema,
  OrderPaymentSchema,
  PaymentRefGuardDocSchema,
} from './order';
export type {
  CounterDoc,
  OrderAmounts,
  OrderDoc,
  OrderEventDoc,
  OrderFulfilment,
  OrderItem,
  OrderPayment,
  PaymentRefGuardDoc,
} from './order';

export {
  ADMIN_READ_STATE_FIELD,
  USER_READ_STATE_FIELD,
  NotificationDocSchema,
  notificationId,
} from './notification';
export type { NotificationDoc } from './notification';

export { PUBLIC_REVIEW_STATUS, ReviewDocSchema } from './review';
export type { ReviewDoc } from './review';

export { RefundDocSchema } from './refund';
export type { RefundDoc } from './refund';

export {
  CHECKOUT_SETTINGS_ID,
  CheckoutSettingsDocSchema,
  DailyAnalyticsDocSchema,
} from './settings';
export type { CheckoutSettingsDoc, DailyAnalyticsDoc } from './settings';
