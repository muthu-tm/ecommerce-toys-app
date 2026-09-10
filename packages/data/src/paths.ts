/**
 * Firestore paths.
 *
 * Every collection name in the platform is a string exactly once, here. That is not
 * tidiness — a mistyped collection name in Firestore does not error. It reads an
 * empty collection and writes a new one, so `collection('notifcations')` produces a
 * feed that is permanently empty and a shadow collection nobody is looking at. The
 * only way to catch it is to never write the string twice.
 *
 * Security rules name the same collections in a language that cannot import this
 * module, so the rules test suite asserts every name here has a matching `match`
 * block. That is the seam where a rename would otherwise leave a collection
 * unprotected.
 */

/**
 * Top-level collection IDs.
 *
 * `as const` so `COLLECTIONS.products` has the literal type `'products'` and a typo
 * is a compile error at the reference rather than a runtime miss.
 */
export const COLLECTIONS = {
  products: 'products',
  categories: 'categories',
  warehouses: 'warehouses',
  inventory: 'inventory',
  inventoryLedger: 'inventoryLedger',
  reservations: 'reservations',
  users: 'users',
  identityIndex: 'identityIndex',
  carts: 'carts',
  orders: 'orders',
  events: 'events',
  paymentRefGuards: 'paymentRefGuards',
  refunds: 'refunds',
  counters: 'counters',
  notifications: 'notifications',
  reviews: 'reviews',
  settings: 'settings',
  analytics: 'analytics',
} as const;

export type CollectionId = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

/** Subcollection IDs, which are only meaningful under a parent document. */
export const SUBCOLLECTIONS = {
  /** `products/{productId}/variants/{variantId}` */
  variants: 'variants',
  /** `users/{uid}/addresses/{addressId}` */
  addresses: 'addresses',
  /** `users/{uid}/wishlist/{productId}` */
  wishlist: 'wishlist',
  /** `orders/{orderId}/events/{eventId}` — the per-order audit trail. */
  orderEvents: 'events',
  /** `analytics/rollups/daily/{yyyy-mm-dd}` */
  daily: 'daily',
} as const;

/**
 * Document IDs that are fixed rather than generated.
 *
 * A singleton document is a deliberate choice in each case: one counter that every
 * order transaction contends on, one settings document that the storefront reads on
 * every checkout render.
 */
export const FIXED_DOCUMENT_IDS = {
  /** `settings/checkout` — the publicly readable commerce parameters. */
  checkoutSettings: 'checkout',
  /** `counters/orderHumanId` — backs the customer-facing order number. */
  orderHumanIdCounter: 'orderHumanId',
  /**
   * `analytics/rollups` — the parent document of the rollup subcollections.
   *
   * `DATA_MODEL.md` wrote this path as `analytics/daily/{yyyy-mm-dd}`, which is three
   * segments and therefore a *collection* path, not a document. A rollup needs an
   * even count, so the parent document is named `rollups` and the granularity becomes
   * the subcollection: `analytics/rollups/daily/{date}`. Weekly and monthly rollups
   * then sit beside it without a second top-level collection.
   */
  analyticsRollups: 'rollups',
} as const;

/**
 * Path builders.
 *
 * Slash-joined strings rather than SDK references, so this module stays free of any
 * Firebase import and can be used by the rules tests, which drive the *client* SDK,
 * as well as by server code driving the Admin SDK.
 */
export const paths = {
  product: (productId: string): string => `${COLLECTIONS.products}/${productId}`,
  variants: (productId: string): string =>
    `${COLLECTIONS.products}/${productId}/${SUBCOLLECTIONS.variants}`,
  variant: (productId: string, variantId: string): string =>
    `${COLLECTIONS.products}/${productId}/${SUBCOLLECTIONS.variants}/${variantId}`,

  category: (categoryId: string): string => `${COLLECTIONS.categories}/${categoryId}`,
  warehouse: (warehouseId: string): string => `${COLLECTIONS.warehouses}/${warehouseId}`,

  /** Keyed by variant ID, so a checkout touches one document per line item. */
  inventory: (variantId: string): string => `${COLLECTIONS.inventory}/${variantId}`,
  ledgerEntry: (entryId: string): string => `${COLLECTIONS.inventoryLedger}/${entryId}`,
  reservation: (reservationId: string): string => `${COLLECTIONS.reservations}/${reservationId}`,

  user: (uid: string): string => `${COLLECTIONS.users}/${uid}`,
  addresses: (uid: string): string => `${COLLECTIONS.users}/${uid}/${SUBCOLLECTIONS.addresses}`,
  address: (uid: string, addressId: string): string =>
    `${COLLECTIONS.users}/${uid}/${SUBCOLLECTIONS.addresses}/${addressId}`,
  wishlist: (uid: string): string => `${COLLECTIONS.users}/${uid}/${SUBCOLLECTIONS.wishlist}`,
  wishlistItem: (uid: string, productId: string): string =>
    `${COLLECTIONS.users}/${uid}/${SUBCOLLECTIONS.wishlist}/${productId}`,

  /** The document ID is the normalised email or E.164 number. Server-only. */
  identityIndexEntry: (normalizedIdentifier: string): string =>
    `${COLLECTIONS.identityIndex}/${normalizedIdentifier}`,

  cart: (cartId: string): string => `${COLLECTIONS.carts}/${cartId}`,

  order: (orderId: string): string => `${COLLECTIONS.orders}/${orderId}`,
  orderEvents: (orderId: string): string =>
    `${COLLECTIONS.orders}/${orderId}/${SUBCOLLECTIONS.orderEvents}`,
  orderEvent: (orderId: string, eventId: string): string =>
    `${COLLECTIONS.orders}/${orderId}/${SUBCOLLECTIONS.orderEvents}/${eventId}`,

  event: (eventId: string): string => `${COLLECTIONS.events}/${eventId}`,
  /** The document ID is the normalised UTR. Existence means the reference is claimed. */
  paymentRefGuard: (normalizedUtr: string): string =>
    `${COLLECTIONS.paymentRefGuards}/${normalizedUtr}`,
  refund: (refundId: string): string => `${COLLECTIONS.refunds}/${refundId}`,
  counter: (counterId: string): string => `${COLLECTIONS.counters}/${counterId}`,
  orderHumanIdCounter: (): string =>
    `${COLLECTIONS.counters}/${FIXED_DOCUMENT_IDS.orderHumanIdCounter}`,

  notification: (notificationId: string): string =>
    `${COLLECTIONS.notifications}/${notificationId}`,
  review: (reviewId: string): string => `${COLLECTIONS.reviews}/${reviewId}`,

  settings: (settingsId: string): string => `${COLLECTIONS.settings}/${settingsId}`,
  checkoutSettings: (): string => `${COLLECTIONS.settings}/${FIXED_DOCUMENT_IDS.checkoutSettings}`,

  dailyAnalytics: (date: string): string =>
    `${COLLECTIONS.analytics}/${FIXED_DOCUMENT_IDS.analyticsRollups}/${SUBCOLLECTIONS.daily}/${date}`,
} as const;

/**
 * Splits a path into its collection and document segments.
 *
 * Used by the seed's writer to turn a path back into a Firestore reference without
 * every call site knowing whether it is holding a two-segment or a four-segment path.
 * Throws on an even-segment count, because that is a collection path being used
 * where a document was expected — a mistake that would otherwise surface as
 * `Value for argument "documentPath" must point to a document`.
 */
export function splitDocumentPath(path: string): readonly string[] {
  const segments = path.split('/').filter((segment) => segment !== '');

  if (segments.length === 0 || segments.length % 2 !== 0) {
    throw new TypeError(
      `"${path}" is not a document path. A document path has an even number of segments, e.g. "products/abc" or "products/abc/variants/def".`,
    );
  }

  return segments;
}
