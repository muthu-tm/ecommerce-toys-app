import { z } from 'zod';

import { PostalAddressSchema } from '../entities/common';
import { AddressDocSchema } from '../entities/user';
import { AddressIdSchema } from '../primitives/ids';

/**
 * The address wire contracts.
 *
 * Addresses are client-READ and API-WRITTEN: the account and checkout pages read a customer's own
 * addresses straight from Firestore under the rules, but every write crosses this boundary so the
 * server can hold the two invariants a client cannot — exactly one default, and never zero defaults
 * while an address exists. The request carries the postal fields, the customer's own label, and
 * whether this address should be the default; the server decides the rest (the first address is the
 * default regardless, and promoting one demotes the others).
 */

/**
 * Create an address.
 *
 * The full postal shape plus a `label` the customer chose ("Home", "Amma's place") and an
 * `isDefault` intent. `isDefault` is a request, not a guarantee: the first address is always the
 * default, and the server demotes any previous default when this one is promoted.
 */
export const AddressCreateRequestSchema = z.object({
  label: z.string().trim().min(1).max(40),
  ...PostalAddressSchema.shape,
  isDefault: z.boolean(),
});
export type AddressCreateRequest = z.infer<typeof AddressCreateRequestSchema>;

/**
 * Edit an address.
 *
 * Every field is optional — a partial patch — but at least one must be present, so an empty body is
 * a 400 rather than a no-op write. Passing `isDefault: true` promotes this address (and demotes the
 * others); passing `false` is ignored, because the default changes by promoting another, never by
 * leaving the customer with none.
 */
export const AddressUpdateRequestSchema = z
  .object({
    label: z.string().trim().min(1).max(40),
    recipientName: z.string().min(1).max(120),
    line1: z.string().min(1).max(200),
    line2: z.string().max(200).nullable(),
    city: z.string().min(1).max(100),
    state: z.string().min(1).max(100),
    pincode: z.string().regex(/^[1-9]\d{5}$/, { error: 'Enter a valid 6-digit PIN code.' }),
    phone: z.string().min(4).max(30),
    isDefault: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    error: 'Provide at least one field to update.',
  });
export type AddressUpdateRequest = z.infer<typeof AddressUpdateRequestSchema>;

/**
 * An address as the account and checkout pages render it — the stored document plus its ID.
 *
 * The same shape the client reads directly from Firestore, echoed by the create/update responses so
 * a form reflects the committed state (including a server-decided default) without a re-read.
 */
export const AddressViewSchema = AddressDocSchema.extend({ id: AddressIdSchema });
export type AddressView = z.infer<typeof AddressViewSchema>;

/** The result of creating an address — the created address, with its server-decided default. */
export const AddressCreateResponseSchema = AddressViewSchema;
export type AddressCreateResponse = z.infer<typeof AddressCreateResponseSchema>;
