/**
 * `@romp/data` — the Firestore boundary.
 *
 * Three responsibilities, and nothing else:
 *
 *  1. **Paths.** Every collection name in the platform is a string exactly once, in
 *     `paths.ts`. A mistyped collection name does not error in Firestore — it reads an
 *     empty collection and writes a new one — so the only defence is never to write
 *     the string twice.
 *  2. **Converters.** Every document is validated against its schema on read *and* on
 *     write. Read validation is the half usually skipped and the half that matters
 *     more: the write that corrupted a document may have shipped weeks ago.
 *  3. **The seed.** Store config in, documents out, deterministically — reached at
 *     `@romp/data/seed`.
 *
 * Repositories, the `SearchPort` and the `StoreContext` seam land here in Task 7. The
 * shape they will take is already visible: a repository is a function over these
 * converters and paths that takes the caller's identity explicitly, because the Admin
 * SDK bypasses security rules and ownership filtering is therefore the server's own
 * job (ADR-0001, `SECURITY.md § trust boundaries`).
 */

export { COLLECTIONS, FIXED_DOCUMENT_IDS, SUBCOLLECTIONS, paths, splitDocumentPath } from './paths';
export type { CollectionId } from './paths';

export { decodeTimestamps, isTimestampLike } from './timestamps';

export { DocumentShapeError, createConverter, withId } from './converter';
export type { WithId } from './converter';

export { CONVERTER_COLLECTIONS, converters } from './converters';
export type { ConverterName } from './converters';

export { addMinutes, fixedClock, systemClock } from './clock';
export type { Clock } from './clock';

// --- the two seams every repository takes explicitly -------------------------
export {
  ANONYMOUS,
  actorIdOf,
  asCustomer,
  asOperator,
  asSystem,
  createStoreContext,
  isOwner,
  isStaff,
  ownsOrIsStaff,
  requireOwnerRole,
  requireOwnership,
  requireStaff,
  uidOf,
} from './context';
export type { Caller, Role, StoreContext } from './context';

export { decodeCursor, decodeOrderCursor, encodeCursor, encodeOrderCursor } from './cursor';
export type { DecodedCursor, DecodedOrderCursor } from './cursor';

export { isAlreadyExists } from './firestore-errors';

export { countQuery, getDocument, getDocuments, runQuery } from './repositories/read';

export * from './repositories/catalogue';
export * from './repositories/catalogue-write';
export * from './repositories/category-write';
export * from './repositories/cart-write';
export * from './repositories/order-write';
export * from './repositories/payment-write';
export * from './repositories/reservation-write';
export * from './repositories/verification-write';
export * from './repositories/refund-write';
export * from './repositories/fulfilment-write';
export * from './repositories/cancel-write';
export * from './repositories/analytics-write';
export * from './repositories/inventory-write';
export * from './repositories/accounts';
export * from './repositories/identity';
export * from './repositories/events';
export * from './repositories/orders';
export * from './repositories/inventory';

// --- the catalogue search seam (ADR-0002) ------------------------------------
// Callers see `SearchPort`. The Firestore adapter is the only file in the platform
// that turns a `ProductQuery` into a Firestore query, which is what makes the
// Typesense swap in v1.1 contained rather than aspirational.
export type { SearchPort } from './search/port';
export { firestoreSearchPort, toProductSummary } from './search/firestore';
export { createMemorySearchPort } from './search/memory';
export type { MemorySearchStore } from './search/memory';

export { buildSearchTokens, normaliseSearchText, searchQueryToken } from './search-tokens';
