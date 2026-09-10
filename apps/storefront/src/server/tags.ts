/**
 * The cache-tag vocabulary, re-exported from `@romp/core`.
 *
 * The definition moved to `@romp/core` in Task 12 so the write side (`apps/api`, which
 * cannot import `next`) and the read side (this app) share one source — a read that tags
 * `product:{slug}` and a write that revalidates the same string cannot drift when both come
 * from the same module. This file stays as the storefront's import point so the pages that
 * reference `cacheTags` do not all reach across the package boundary directly.
 */
export { cacheTags, tagsForProduct } from '@romp/core';
