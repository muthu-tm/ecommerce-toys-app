import { decideMediaFinalize } from '@romp/core';
import { finalizeProductMedia } from '@romp/data';
import type { StoreContext } from '@romp/data';
import type { AppLogger } from '@romp/observability';

/**
 * The media-finalize decision logic, independent of Cloud Storage and Firestore triggers.
 *
 * The `onObjectFinalized` trigger in `functions.ts` is thin glue over this: it turns a
 * Storage event into the four things this needs — the product ID and object path from the
 * event params, and the bytes and declared type from the object — and provides the
 * side-effecting operations (delete the object, write to the product) as injected functions.
 * That injection is what lets the accept/quarantine branching be unit-tested without a
 * Storage emulator or a Functions runtime, which the infra harness does not run.
 *
 * The security decision itself is `@romp/core`'s `decideMediaFinalize`, a pure sniff of the
 * bytes. This module is the orchestration around it: on quarantine, remove the media entry
 * from the product **and** delete the object so a rejected file leaves nothing behind; on
 * accept, read the real dimensions and write them onto the entry.
 */

/** The side effects the finalize logic needs, injected so the core is testable. */
export interface MediaFinalizeDeps {
  /** Reads the finalized object's bytes (a prefix is enough for a header sniff). */
  readonly readObjectHead: (objectPath: string) => Promise<Uint8Array>;
  /** The object's declared content type, from its Storage metadata. */
  readonly declaredContentType: (objectPath: string) => Promise<string>;
  /** Deletes the object — used to remove a quarantined upload from the bucket. */
  readonly deleteObject: (objectPath: string) => Promise<void>;
  /** Reads intrinsic dimensions from the object's bytes, or null if unavailable. */
  readonly readDimensions: (
    bytes: Uint8Array,
    contentType: string,
  ) => { readonly width: number; readonly height: number } | null;
}

export interface FinalizeMediaInput {
  readonly productId: string;
  readonly objectPath: string;
}

export type FinalizeMediaOutcome = 'accepted' | 'quarantined';

/**
 * Applies the finalize decision to one uploaded object.
 *
 * Reads the object head and its declared type, asks `@romp/core` whether to accept it, and
 * then acts: a quarantine removes the media entry and deletes the object; an accept reads the
 * dimensions and fills them in (a null read leaves the placeholder, which is honest — better
 * a reserved 1×1 box than a wrong intrinsic size). Returns the outcome so the trigger can log
 * it. Uses the `system` caller because there is no human behind an object-finalize event.
 */
export async function finalizeMediaObject(
  ctx: StoreContext,
  caller: Parameters<typeof finalizeProductMedia>[1],
  deps: MediaFinalizeDeps,
  input: FinalizeMediaInput,
  logger: AppLogger,
): Promise<FinalizeMediaOutcome> {
  const [bytes, declaredType] = await Promise.all([
    deps.readObjectHead(input.objectPath),
    deps.declaredContentType(input.objectPath),
  ]);

  const decision = decideMediaFinalize(bytes, declaredType);

  if (decision.action === 'quarantine') {
    // Remove the entry from the product first, then delete the object. Order matters: the
    // product must stop referencing a file before the file is gone, so a reader never
    // resolves a media path to a 404.
    await finalizeProductMedia(ctx, caller, input.productId, input.objectPath, null);
    await deps.deleteObject(input.objectPath).catch((error: unknown) => {
      // The entry is already gone from the product, so a failed object delete is a stray
      // file, not a broken page — log it for cleanup rather than failing the finalize.
      logger.warn(
        { event: 'media.quarantine_delete_failed', objectPath: input.objectPath, error },
        'media.quarantine_delete_failed',
      );
    });
    logger.warn(
      { event: 'media.quarantined', objectPath: input.objectPath, reason: decision.reason },
      'media.quarantined',
    );
    return 'quarantined';
  }

  const dimensions = deps.readDimensions(bytes, decision.contentType);
  await finalizeProductMedia(
    ctx,
    caller,
    input.productId,
    input.objectPath,
    dimensions === null
      ? // Keep the placeholder dimensions but confirm the entry (blurhash stays null until a
        // resize pass produces one). A null-dimension accept still records that the file is a
        // valid image; the resize extension's output carries the true size for rendering.
        { path: input.objectPath, width: 1, height: 1, blurhash: null }
      : {
          path: input.objectPath,
          width: dimensions.width,
          height: dimensions.height,
          blurhash: null,
        },
  );
  logger.info({ event: 'media.finalized', objectPath: input.objectPath }, 'media.finalized');
  return 'accepted';
}

/**
 * Splits a product-media object path into its product ID and file name.
 *
 * The upload path is `products/{productId}/{fileName}` (allocated by the media route). A path
 * that does not match — a store asset, a payment proof, a stray upload — returns null, and
 * the trigger ignores it rather than trying to finalize something that is not product media.
 */
export function parseProductMediaPath(
  objectPath: string,
): { readonly productId: string; readonly fileName: string } | null {
  const segments = objectPath.split('/');
  if (segments.length !== 3 || segments[0] !== 'products') return null;
  const [, productId, fileName] = segments;
  if (productId === undefined || productId === '' || fileName === undefined || fileName === '') {
    return null;
  }
  return { productId, fileName };
}
