/**
 * Image type re-derivation from a file's own bytes.
 *
 * `infra/storage.rules` says it plainly: the declared content type is a claim, not a fact —
 * `request.resource.contentType` is whatever the uploading client said. The authoritative
 * check happens on object finalize, by reading the file's magic bytes. A file that claims
 * `image/png` but begins with `<svg><script>` is a stored-XSS vector on the admin origin;
 * catching it means comparing the declared type against what the bytes actually are and
 * quarantining any mismatch.
 *
 * This is the security-critical half of the finalize pipeline, and it is pure — bytes in, a
 * verdict out — so it is unit-tested against crafted headers rather than only observed in
 * the emulator. It lives in `@romp/core` because the decision must be identical wherever it
 * runs and it carries no dependency. Reading a file's *dimensions* is a separate, non-
 * security concern handled beside the Cloud Function (with a library and the resize
 * extension's output), not here — a wrong dimension is a layout shift, a wrong type is an
 * exploit, and only the second belongs in the shared, dependency-free core.
 *
 * Only the four allowed raster formats are recognised (JPEG, PNG, WebP, AVIF), matching the
 * storage rules' allow-list. Anything else — SVG especially — sniffs to `null`, which the
 * finalize decision treats as "not an allowed image" and quarantines.
 */

export type AllowedImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif';

/** Whether the bytes at `offset` match the given ASCII string. */
function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset + text.length > bytes.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

/**
 * Detects the image type from a file's leading bytes, or null if it is not an allowed image.
 *
 * The signatures are the standard ones:
 *  - JPEG: `FF D8 FF`
 *  - PNG:  `89 50 4E 47 0D 0A 1A 0A`
 *  - WebP: `RIFF....WEBP`
 *  - AVIF: an ISO-BMFF `ftyp` box whose brand is `avif` or `avis`
 *
 * SVG, GIF and everything else return null — deliberately, because the storage rules do not
 * allow them and the point of this check is to reject a file lying about being one of the
 * four we serve.
 */
export function sniffImageType(bytes: Uint8Array): AllowedImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    asciiAt(bytes, 1, 'PNG') &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WEBP')) {
    return 'image/webp';
  }

  // AVIF: `ftyp` at offset 4, brand at offset 8. `avis` is the image-sequence brand.
  if (asciiAt(bytes, 4, 'ftyp') && (asciiAt(bytes, 8, 'avif') || asciiAt(bytes, 8, 'avis'))) {
    return 'image/avif';
  }

  return null;
}
