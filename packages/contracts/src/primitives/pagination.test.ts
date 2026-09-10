import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  CursorSchema,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PageRequestSchema,
  pagedSchema,
} from './pagination';

describe('PageRequestSchema', () => {
  it('defaults the page size', () => {
    expect(PageRequestSchema.parse({})).toEqual({ limit: DEFAULT_PAGE_SIZE });
  });

  it('coerces a query-string limit', () => {
    // Query parameters arrive as strings; requiring the caller to convert would
    // make every route repeat the same parse.
    expect(PageRequestSchema.parse({ limit: '10' })).toMatchObject({ limit: 10 });
  });

  it('rejects a limit above the maximum rather than silently capping it', () => {
    // Quietly returning fewer results than asked for makes a client's pagination
    // look broken for reasons it cannot see.
    expect(PageRequestSchema.safeParse({ limit: MAX_PAGE_SIZE + 1 }).success).toBe(false);
  });

  it.each([0, -1, 1.5])('rejects a limit of %s', (limit) => {
    expect(PageRequestSchema.safeParse({ limit }).success).toBe(false);
  });

  it('carries an opaque cursor through unchanged', () => {
    const parsed = PageRequestSchema.parse({ cursor: 'eyJvIjoxMH0' });

    expect(parsed.cursor).toBe('eyJvIjoxMH0');
  });

  it('rejects an empty cursor', () => {
    expect(CursorSchema.safeParse('').success).toBe(false);
  });
});

describe('pagedSchema', () => {
  const schema = pagedSchema(z.object({ id: z.string() }));

  it('validates a page of items', () => {
    const page = schema.parse({ items: [{ id: 'a' }, { id: 'b' }], nextCursor: 'next' });

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe('next');
  });

  it('requires nextCursor to be present and null on the last page', () => {
    // Null rather than absent, so a client can tell "no more results" from "the
    // field was forgotten".
    expect(schema.parse({ items: [], nextCursor: null }).nextCursor).toBeNull();
    expect(schema.safeParse({ items: [] }).success).toBe(false);
  });

  it('rejects items that do not match the element schema', () => {
    expect(schema.safeParse({ items: [{ id: 1 }], nextCursor: null }).success).toBe(false);
  });
});
