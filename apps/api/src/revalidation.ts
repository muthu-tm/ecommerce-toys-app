/**
 * The ISR cache tags a catalogue write must revalidate, from `@romp/core`.
 *
 * The API cannot import `next`, so it does not call `revalidateTag` itself — it computes the
 * tags and hands them to the injected `revalidate` seam (`deps.revalidate`), which the
 * deployment wires to the storefront. The vocabulary is shared with the storefront through
 * `@romp/core` so the tags a write busts are exactly the tags the reads were cached under.
 */
export { tagsForProduct } from '@romp/core';
