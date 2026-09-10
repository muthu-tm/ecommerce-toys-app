import { z } from 'zod';

import { ErrorCodeSchema } from './error-codes';

/**
 * RFC 7807 `application/problem+json`, plus two additions.
 *
 * - `code` — the stable machine-readable contract. RFC 7807's `type` is a URI and
 *   is fine for documentation, but clients should not be parsing URLs to branch on
 *   an error, so `code` is the field they use.
 * - `requestId` — echoes `x-request-id`, so a customer can quote it in a support
 *   message and an engineer can find the exact log line. This is the only detail an
 *   `INTERNAL` response carries.
 */

export const ValidationIssueSchema = z.object({
  /**
   * Dotted path to the offending field, array indices included: `items.0.qty`.
   * Dotted rather than a JSON Pointer because clients map it straight onto form
   * field names.
   */
  path: z.string(),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const ProblemDetailsSchema = z.object({
  /** URI reference identifying the error class. */
  type: z.string(),
  /** Short human-readable summary, stable for a given `code`. */
  title: z.string(),
  status: z.int().min(400).max(599),
  /** Stable machine-readable code. Branch on this. */
  code: ErrorCodeSchema,
  /** Human-readable explanation of *this* occurrence. May be reworded; do not parse. */
  detail: z.string().optional(),
  /** Correlation ID for this request. */
  requestId: z.string().optional(),
  /** Present only for validation failures. */
  errors: z.array(ValidationIssueSchema).optional(),
  /** Seconds to wait, on `RATE_LIMITED`. Mirrors the `Retry-After` header. */
  retryAfterSeconds: z.int().positive().optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

export const PROBLEM_JSON_CONTENT_TYPE = 'application/problem+json';
