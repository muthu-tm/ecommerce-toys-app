import type { FastifyReply, FastifyRequest } from 'fastify';

import { IdempotencyKeySchema } from '@romp/contracts';
import { parseOrThrow, ValidationFailedError } from '@romp/observability';

/**
 * Idempotency for money-critical POSTs.
 *
 * `API.md` requires `Idempotency-Key` on order placement and payment-proof submission,
 * where a retry would otherwise double-reserve stock or double-claim a payment reference.
 * Replaying a key returns the *original* response rather than repeating the effect.
 *
 * The store is an interface, not a concrete Firestore call, so a route test runs against an
 * in-memory implementation and production runs against a persisted one (added to
 * `@romp/data`). The mechanism — reserve the key, run the handler once, cache the response —
 * is the same either way.
 */

export interface IdempotencyRecord {
  readonly statusCode: number;
  readonly body: unknown;
}

export interface IdempotencyStore {
  /** Returns a stored response for this key, or null if it is unseen. */
  get(key: string): Promise<IdempotencyRecord | null>;
  /** Persists the response for a key so a replay returns it. */
  put(key: string, record: IdempotencyRecord): Promise<void>;
}

/**
 * An in-memory store, for tests and single-instance development.
 *
 * Not for production across instances: a replay that lands on a different Cloud Functions
 * instance would miss the cache. The Firestore-backed store in `@romp/data` is the
 * production implementation; this is the injectable default that keeps route tests off the
 * network.
 */
export function createMemoryIdempotencyStore(): IdempotencyStore {
  const records = new Map<string, IdempotencyRecord>();
  return {
    get: (key) => Promise.resolve(records.get(key) ?? null),
    put: (key, record) => {
      records.set(key, record);
      return Promise.resolve();
    },
  };
}

/**
 * Reads and validates the `Idempotency-Key` header.
 *
 * `required` routes throw `VALIDATION_FAILED` when it is absent; optional routes return
 * null and run without replay protection. Either way the key is schema-checked, because it
 * becomes part of a stored record.
 */
export function idempotencyKey(request: FastifyRequest, required: boolean): string | null {
  const raw = request.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === '') {
    if (required) {
      throw new ValidationFailedError(
        [{ path: 'Idempotency-Key', message: 'This header is required on this request.' }],
        { detail: 'A retry-safe idempotency key is required here.' },
      );
    }
    return null;
  }
  return parseOrThrow(IdempotencyKeySchema, value, 'The idempotency key is malformed.');
}

/**
 * Runs a handler under idempotency: replays a stored response for a seen key, otherwise
 * runs the handler once and caches its result.
 *
 * The handler returns the body it would send; this wrapper is what decides whether to run
 * it. Keeping the run/replay decision here rather than in each handler means no handler can
 * forget to check the store first.
 */
export async function withIdempotency(
  store: IdempotencyStore,
  key: string | null,
  reply: FastifyReply,
  handler: () => Promise<{ statusCode: number; body: unknown }>,
): Promise<unknown> {
  if (key === null) {
    const result = await handler();
    return reply.code(result.statusCode).send(result.body);
  }

  const existing = await store.get(key);
  if (existing !== null) {
    return reply.code(existing.statusCode).send(existing.body);
  }

  const result = await handler();
  await store.put(key, { statusCode: result.statusCode, body: result.body });
  return reply.code(result.statusCode).send(result.body);
}
