import type { AllowedImageType } from './image';
import { sniffImageType } from './image';

/**
 * The finalize decision for an uploaded media object.
 *
 * A pure function over the object's bytes and the type the upload declared, so the
 * security-critical judgement — does the file's content match what it claimed, and is it an
 * allowed image at all — is unit-tested rather than only observed in the emulator. The Cloud
 * Function that runs on object finalize is thin glue over this: it reads the bytes, calls
 * this, and either quarantines the object or (on accept) reads the dimensions and writes them
 * back onto the product's media entry.
 *
 * Quarantine is the safe default. A file whose bytes do not sniff to an allowed image, or
 * whose real type differs from the declared one, is rejected — because that mismatch is
 * exactly the shape of the stored-XSS attempt the storage rules' comment describes (an
 * "image" that is really an SVG with a script). Accepting only a byte-confirmed image is
 * what makes the declared content type stop mattering.
 */

export type MediaFinalizeDecision =
  | { readonly action: 'quarantine'; readonly reason: MediaQuarantineReason }
  | { readonly action: 'accept'; readonly contentType: AllowedImageType };

export type MediaQuarantineReason = 'not_an_allowed_image' | 'type_mismatch';

/**
 * Decides whether a finalized upload is accepted or quarantined.
 *
 * `declaredContentType` is what the client said on upload (from the object metadata). It is
 * only used to detect a *mismatch* — the accept decision is based entirely on what the bytes
 * are, never on the claim. A null sniff means the bytes are not one of the four allowed
 * raster formats, which is quarantined regardless of what was declared.
 */
export function decideMediaFinalize(
  bytes: Uint8Array,
  declaredContentType: string,
): MediaFinalizeDecision {
  const sniffed = sniffImageType(bytes);
  if (sniffed === null) {
    return { action: 'quarantine', reason: 'not_an_allowed_image' };
  }
  if (sniffed !== declaredContentType) {
    // The bytes are a valid allowed image, but not the type the upload claimed. Reject it:
    // a file that lies about its type is the exact signal this check exists to catch.
    return { action: 'quarantine', reason: 'type_mismatch' };
  }

  return { action: 'accept', contentType: sniffed };
}
