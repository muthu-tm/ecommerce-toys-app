import type { FastifyReply } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { ValidationFailedError } from '@romp/observability';

import { createMemoryIdempotencyStore, idempotencyKey, withIdempotency } from './idempotency';

/** A minimal reply double recording the code and body it was sent. */
function fakeReply(): FastifyReply & { sent: { code: number; body: unknown } } {
  const state = { code: 0, body: undefined as unknown };
  const reply = {
    code(value: number) {
      state.code = value;
      return reply;
    },
    send(body: unknown) {
      state.body = body;
      return reply;
    },
    get sent() {
      return state;
    },
  };
  return reply as unknown as FastifyReply & { sent: { code: number; body: unknown } };
}

function request(headers: Record<string, string | undefined>) {
  return { headers } as unknown as Parameters<typeof idempotencyKey>[0];
}

describe('idempotencyKey', () => {
  it('returns a validated key when present', () => {
    expect(idempotencyKey(request({ 'idempotency-key': 'abcd1234efgh' }), true)).toBe(
      'abcd1234efgh',
    );
  });

  it('throws when required and absent', () => {
    expect(() => idempotencyKey(request({}), true)).toThrow(ValidationFailedError);
  });

  it('returns null when optional and absent', () => {
    expect(idempotencyKey(request({}), false)).toBeNull();
  });

  it('throws on a malformed key', () => {
    expect(() => idempotencyKey(request({ 'idempotency-key': 'short' }), false)).toThrow(
      ValidationFailedError,
    );
  });
});

describe('withIdempotency', () => {
  it('runs the handler once for a fresh key and caches the response', async () => {
    const store = createMemoryIdempotencyStore();
    const handler = vi.fn(() => Promise.resolve({ statusCode: 201, body: { id: 'order-1' } }));

    const first = fakeReply();
    await withIdempotency(store, 'key-1', first, handler);
    expect(first.sent).toEqual({ code: 201, body: { id: 'order-1' } });

    // A replay of the same key returns the stored response without re-running the handler.
    const second = fakeReply();
    await withIdempotency(store, 'key-1', second, handler);
    expect(second.sent).toEqual({ code: 201, body: { id: 'order-1' } });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('runs the handler every time when there is no key', async () => {
    const store = createMemoryIdempotencyStore();
    const handler = vi.fn(() => Promise.resolve({ statusCode: 200, body: { ok: true } }));

    await withIdempotency(store, null, fakeReply(), handler);
    await withIdempotency(store, null, fakeReply(), handler);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
