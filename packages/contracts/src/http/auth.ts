import { z } from 'zod';

import { IdentifierTypeSchema } from '../primitives/identifiers';

/**
 * Request and response contracts for the identity endpoints.
 *
 * These describe what crosses the wire, not what is stored — the raw identifier a customer
 * types, before `@romp/core` normalises it, and the derived tier a `users` document does
 * not carry. The password is validated for *length* here only; its strength is assessed by
 * `@romp/core`'s policy, which needs the identifier and brand as context and so runs in the
 * handler rather than the schema.
 *
 * The identifier is a plain bounded string on purpose: it may be an email *or* a mobile
 * number in any of the spellings a customer writes, and classifying and normalising it is
 * the handler's first step. A schema that demanded a valid email or E.164 here would reject
 * `98450 21174` before the phone normaliser ever saw it.
 */

/** The raw login identifier: an email or a mobile number, unnormalised. */
const RawIdentifierSchema = z
  .string()
  .trim()
  .min(3, { error: 'Enter your email or mobile number.' })
  .max(254);

/** The password, length-bounded only. Strength is the policy's job, in the handler. */
const RawPasswordSchema = z
  .string()
  .min(1, { error: 'Enter a password.' })
  .max(256, { error: 'That password is too long.' });

export const RegisterRequestSchema = z.object({
  identifier: RawIdentifierSchema,
  password: RawPasswordSchema,
  displayName: z.string().trim().min(1, { error: 'Enter your name.' }).max(120),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const RegisterResponseSchema = z.object({
  uid: z.string(),
  /**
   * The derived Firebase Auth login email — the real email, or the phone alias. The client
   * signs in with this and the same password immediately after.
   */
  loginEmail: z.string(),
  primaryIdentifierType: IdentifierTypeSchema,
});
export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;

export const CheckIdentifierRequestSchema = z.object({
  identifier: RawIdentifierSchema,
});
export type CheckIdentifierRequest = z.infer<typeof CheckIdentifierRequestSchema>;

export const CheckIdentifierResponseSchema = z.object({
  /** Whether the identifier is available to register. */
  available: z.boolean(),
});
export type CheckIdentifierResponse = z.infer<typeof CheckIdentifierResponseSchema>;

export const PasswordChangeRequestSchema = z.object({
  currentPassword: RawPasswordSchema,
  newPassword: RawPasswordSchema,
});
export type PasswordChangeRequest = z.infer<typeof PasswordChangeRequestSchema>;

export const MeUpdateRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    error: 'Provide at least one field to update.',
  });
export type MeUpdateRequest = z.infer<typeof MeUpdateRequestSchema>;

/** The profile the customer sees for themselves, with the derived tier. */
export const MeResponseSchema = z.object({
  uid: z.string(),
  displayName: z.string(),
  primaryIdentifierType: IdentifierTypeSchema,
  /** Masked contact for display — never the raw value the logger would redact. */
  emailPresent: z.boolean(),
  phonePresent: z.boolean(),
  orderCount: z.int().nonnegative(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;
