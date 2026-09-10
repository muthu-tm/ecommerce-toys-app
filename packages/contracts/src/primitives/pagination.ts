import { z } from 'zod';

/**
 * Cursor pagination.
 *
 * Cursors are **opaque strings**, deliberately. Today one encodes a Firestore
 * document snapshot; after the Typesense migration (ADR-0002) it will encode
 * something else entirely. Because clients only ever echo the value back, that
 * change does not alter the URL contract or any client code.
 *
 * Offset pagination was rejected for the same reason it usually is: on a catalogue
 * that changes under the reader, page 2 silently skips or repeats items.
 */
export const CursorSchema = z.string().min(1).max(2_048).brand<'Cursor'>();
export type Cursor = z.infer<typeof CursorSchema>;

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;

export const PageRequestSchema = z.object({
  /**
   * Capped rather than rejected above the maximum? No — rejected. Silently
   * returning fewer results than asked for makes a client's pagination look broken
   * for reasons it cannot see.
   */
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: CursorSchema.optional(),
});
export type PageRequest = z.input<typeof PageRequestSchema>;
export type ResolvedPageRequest = z.output<typeof PageRequestSchema>;

/**
 * Builds a page-response schema for a given item schema.
 *
 * `nextCursor` is null on the last page rather than absent, so a client can
 * distinguish "no more results" from "the field was forgotten".
 */
export function pagedSchema<TItem extends z.ZodType>(item: TItem) {
  return z.object({
    items: z.array(item),
    nextCursor: CursorSchema.nullable(),
  });
}

export interface Paged<TItem> {
  readonly items: readonly TItem[];
  readonly nextCursor: Cursor | null;
}
