import type { PublicStoreConfig } from '@romp/store-config';

import publicConfig from '../generated/public-config.json';

/**
 * The active store's configuration, for the backoffice.
 *
 * Read from the generated JSON the token step writes, the same as the storefront, so the
 * admin's brand name, labels and locale are the store's own. Safe to import from a client
 * component — it carries only `publicRuntimeConfig` fields.
 */
export const store = publicConfig as unknown as PublicStoreConfig;

export const { brand, content, locale, commerce, theme } = store;

export { formatMoney } from '@romp/contracts';

export const moneyFormat = { locale: locale.locale, currency: locale.currency } as const;

/**
 * Resolves a Storage object path to a URL for previewing product media in the backoffice.
 *
 * The same object-path-to-URL join the storefront uses (`NEXT_PUBLIC_MEDIA_BASE_URL`),
 * returning null when no media host is configured so the admin shows a placeholder rather
 * than a broken image — the honest state before the media host is wired.
 */
export function mediaUrl(objectPath: string | null): string | null {
  const base = (process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? '').replace(/\/+$/u, '');
  if (objectPath === null || objectPath === '' || base === '') return null;
  return `${base}/${objectPath.replace(/^\/+/u, '')}`;
}
