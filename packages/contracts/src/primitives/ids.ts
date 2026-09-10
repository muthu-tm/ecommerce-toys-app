import { z } from 'zod';

/**
 * Branded identifier types.
 *
 * All of these are strings at runtime, so without brands they are mutually
 * assignable and `getOrder(productId)` compiles. The brands cost one helper call
 * at construction and remove a whole class of argument-transposition bug —
 * particularly relevant here because several functions take both a `productId`
 * and a `variantId`, in that order, and a `uid` alongside an `orderId`.
 */

/** Firestore auto-IDs are 20 characters; natural keys are shorter. 1–1500 is the Firestore limit. */
const documentId = (label: string) =>
  z
    .string()
    .min(1, { error: `${label} cannot be empty.` })
    .max(1_500, { error: `${label} exceeds the Firestore document ID limit.` })
    // Firestore forbids these in document IDs; catching it here turns a confusing
    // server error into a validation failure with a path.
    .refine((value) => !value.includes('/'), { error: `${label} cannot contain "/".` })
    .refine((value) => value !== '.' && value !== '..', { error: `${label} is a reserved ID.` });

export const StoreIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9-]*$/, {
    error: 'A store ID is lowercase alphanumeric with hyphens, e.g. "romp".',
  })
  .brand<'StoreId'>();
export type StoreId = z.infer<typeof StoreIdSchema>;

export const UidSchema = documentId('A uid').brand<'Uid'>();
export type Uid = z.infer<typeof UidSchema>;

export const ProductIdSchema = documentId('A product ID').brand<'ProductId'>();
export type ProductId = z.infer<typeof ProductIdSchema>;

export const VariantIdSchema = documentId('A variant ID').brand<'VariantId'>();
export type VariantId = z.infer<typeof VariantIdSchema>;

export const CategoryIdSchema = documentId('A category ID').brand<'CategoryId'>();
export type CategoryId = z.infer<typeof CategoryIdSchema>;

export const WarehouseIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, {
    error: 'A warehouse ID is its lowercase code, e.g. "blr".',
  })
  .brand<'WarehouseId'>();
export type WarehouseId = z.infer<typeof WarehouseIdSchema>;

export const OrderIdSchema = documentId('An order ID').brand<'OrderId'>();
export type OrderId = z.infer<typeof OrderIdSchema>;

export const CartIdSchema = documentId('A cart ID').brand<'CartId'>();
export type CartId = z.infer<typeof CartIdSchema>;

export const ReservationIdSchema = documentId('A reservation ID').brand<'ReservationId'>();
export type ReservationId = z.infer<typeof ReservationIdSchema>;

export const RefundIdSchema = documentId('A refund ID').brand<'RefundId'>();
export type RefundId = z.infer<typeof RefundIdSchema>;

export const ReviewIdSchema = documentId('A review ID').brand<'ReviewId'>();
export type ReviewId = z.infer<typeof ReviewIdSchema>;

export const AddressIdSchema = documentId('An address ID').brand<'AddressId'>();
export type AddressId = z.infer<typeof AddressIdSchema>;

export const EventIdSchema = documentId('An event ID').brand<'EventId'>();
export type EventId = z.infer<typeof EventIdSchema>;

export const NotificationIdSchema = documentId('A notification ID').brand<'NotificationId'>();
export type NotificationId = z.infer<typeof NotificationIdSchema>;

export const LedgerEntryIdSchema = documentId('A ledger entry ID').brand<'LedgerEntryId'>();
export type LedgerEntryId = z.infer<typeof LedgerEntryIdSchema>;

/**
 * `'system'` is the actor on anything not initiated by a human — the reservation
 * sweeper, the notification dispatcher, seed scripts. It is a reserved value so an
 * audit entry can never be ambiguous about whether a person was involved.
 */
export const SYSTEM_ACTOR = 'system';

export const ActorIdSchema = z.union([UidSchema, z.literal(SYSTEM_ACTOR)]);
export type ActorId = z.infer<typeof ActorIdSchema>;
