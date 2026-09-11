import type { PublicStoreConfig } from '@romp/store-config';

import publicConfig from '../generated/public-config.json';

/**
 * The active store's configuration.
 *
 * Read from a generated JSON file rather than by calling the loader, and that matters:
 * the loader touches the filesystem and validates, which is build-time work. By the time
 * a request is served, the config is already known to be valid and is a static import the
 * bundler can inline and tree-shake.
 *
 * This module is safe to import from a client component. It contains only what
 * `publicRuntimeConfig` allows — warehouse addresses and PIN prefixes are excluded, since
 * they are operational detail with no client use.
 *
 * If the import fails, `pnpm store:tokens` has not run. It is wired into `predev` and
 * `prebuild`, so that should only happen on a bare `tsc` in a fresh clone.
 */
export const store = publicConfig as unknown as PublicStoreConfig;

export const { brand, content, contact, features, locale, commerce, theme } = store;

/**
 * Formats an amount for this store's locale and currency.
 *
 * Wraps the shared formatter with the configured locale so no call site has to remember
 * to pass it — and so a second store's prices format for its own locale without a code
 * change.
 */
export { formatMoney } from '@romp/contracts';

export const moneyFormat = { locale: locale.locale, currency: locale.currency } as const;

/**
 * The public base URL for product media.
 *
 * Media is stored as a Storage *object path* (`products/{slug}/cover.webp`), never a
 * download URL — a URL embeds a token that rotates when the object is replaced, so a
 * stored URL breaks on the next upload (`DATA_MODEL.md`). The base is deployment
 * configuration, not brand configuration: the same store serves media from a different
 * host per environment, and in production it is the Cloudflare-fronted Storage domain
 * (ADR-0003).
 *
 * Read lazily rather than into a module-level const, so a test can stub the env var and a
 * `NEXT_PUBLIC_*` value set at deploy time is picked up — a top-level const would freeze
 * the value at import, before either had a chance to set it.
 */
function mediaBase(): string {
  return (process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? '').replace(/\/+$/u, '');
}

/**
 * Resolves a Storage object path to a URL `next/image` can load.
 *
 * Returns null when no base is configured — which is the state of a store before its
 * media host is wired up, and the state under test. A card renders its placeholder for a
 * null URL rather than a broken image, so an unconfigured base degrades visibly rather
 * than silently 404-ing every product photo.
 */
export function mediaUrl(objectPath: string | null): string | null {
  const base = mediaBase();
  if (objectPath === null || objectPath === '' || base === '') return null;
  const clean = objectPath.replace(/^\/+/u, '');
  return `${base}/${clean}`;
}
