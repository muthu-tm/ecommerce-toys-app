import {
  AddressDocSchema,
  CartDocSchema,
  CategoryDocSchema,
  CheckoutSettingsDocSchema,
  CounterDocSchema,
  DailyAnalyticsDocSchema,
  EventDocSchema,
  IdentityIndexDocSchema,
  InventoryDocSchema,
  InventoryLedgerDocSchema,
  NotificationDocSchema,
  OrderDocSchema,
  OrderEventDocSchema,
  PaymentRefGuardDocSchema,
  ProductDocSchema,
  RefundDocSchema,
  ReservationDocSchema,
  ReviewDocSchema,
  UserDocSchema,
  VariantDocSchema,
  WarehouseDocSchema,
  WishlistItemDocSchema,
} from '@romp/contracts';

import { createConverter } from './converter';
import { COLLECTIONS, SUBCOLLECTIONS } from './paths';

/**
 * One validating converter per collection in `docs/DATA_MODEL.md`.
 *
 * Grouped in a single object so the coverage is auditable: a collection with no
 * converter is a collection somebody is reading with `snapshot.data() as OrderDoc`,
 * and a cast validates nothing. The rules test suite cross-checks these keys against
 * the `match` blocks in `firestore.rules`, so adding a collection in one place and
 * forgetting the other fails a test rather than shipping an unprotected path.
 *
 * The collection label passed to each converter is what appears in a
 * `DocumentShapeError`, so it names the collection rather than the type.
 */
export const converters = {
  products: createConverter(ProductDocSchema, COLLECTIONS.products),
  variants: createConverter(VariantDocSchema, SUBCOLLECTIONS.variants),
  categories: createConverter(CategoryDocSchema, COLLECTIONS.categories),

  warehouses: createConverter(WarehouseDocSchema, COLLECTIONS.warehouses),
  inventory: createConverter(InventoryDocSchema, COLLECTIONS.inventory),
  inventoryLedger: createConverter(InventoryLedgerDocSchema, COLLECTIONS.inventoryLedger),
  reservations: createConverter(ReservationDocSchema, COLLECTIONS.reservations),

  users: createConverter(UserDocSchema, COLLECTIONS.users),
  identityIndex: createConverter(IdentityIndexDocSchema, COLLECTIONS.identityIndex),
  addresses: createConverter(AddressDocSchema, SUBCOLLECTIONS.addresses),
  wishlist: createConverter(WishlistItemDocSchema, SUBCOLLECTIONS.wishlist),

  carts: createConverter(CartDocSchema, COLLECTIONS.carts),

  orders: createConverter(OrderDocSchema, COLLECTIONS.orders),
  orderEvents: createConverter(OrderEventDocSchema, SUBCOLLECTIONS.orderEvents),
  events: createConverter(EventDocSchema, COLLECTIONS.events),
  paymentRefGuards: createConverter(PaymentRefGuardDocSchema, COLLECTIONS.paymentRefGuards),
  refunds: createConverter(RefundDocSchema, COLLECTIONS.refunds),
  counters: createConverter(CounterDocSchema, COLLECTIONS.counters),

  notifications: createConverter(NotificationDocSchema, COLLECTIONS.notifications),
  reviews: createConverter(ReviewDocSchema, COLLECTIONS.reviews),

  checkoutSettings: createConverter(CheckoutSettingsDocSchema, COLLECTIONS.settings),
  dailyAnalytics: createConverter(DailyAnalyticsDocSchema, COLLECTIONS.analytics),
} as const;

export type ConverterName = keyof typeof converters;

/**
 * Which collection each converter belongs to.
 *
 * Needed because the mapping is not one-to-one in either direction: `settings` and
 * `analytics` each hold one document shape today but are named generically, and
 * subcollections share a name with their parent path segment. The rules test uses
 * this to check that every collection a converter targets has a `match` block.
 */
export const CONVERTER_COLLECTIONS: Readonly<Record<ConverterName, string>> = Object.freeze({
  products: COLLECTIONS.products,
  variants: SUBCOLLECTIONS.variants,
  categories: COLLECTIONS.categories,
  warehouses: COLLECTIONS.warehouses,
  inventory: COLLECTIONS.inventory,
  inventoryLedger: COLLECTIONS.inventoryLedger,
  reservations: COLLECTIONS.reservations,
  users: COLLECTIONS.users,
  identityIndex: COLLECTIONS.identityIndex,
  addresses: SUBCOLLECTIONS.addresses,
  wishlist: SUBCOLLECTIONS.wishlist,
  carts: COLLECTIONS.carts,
  orders: COLLECTIONS.orders,
  orderEvents: SUBCOLLECTIONS.orderEvents,
  events: COLLECTIONS.events,
  paymentRefGuards: COLLECTIONS.paymentRefGuards,
  refunds: COLLECTIONS.refunds,
  counters: COLLECTIONS.counters,
  notifications: COLLECTIONS.notifications,
  reviews: COLLECTIONS.reviews,
  checkoutSettings: COLLECTIONS.settings,
  dailyAnalytics: COLLECTIONS.analytics,
});
