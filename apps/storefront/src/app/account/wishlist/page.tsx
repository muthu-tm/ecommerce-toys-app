import { notFound } from 'next/navigation';

import { WishlistView } from '@/components/account/WishlistView';
import { features } from '@/lib/store';

export const metadata = { title: 'Saved toys' };

/**
 * The wishlist page.
 *
 * Feature-gated: a store with the wishlist off has no such page — `notFound` rather than an empty
 * screen, matching the server's own refusal of the wishlist routes. The feature flag is build-time
 * config, so this resolves at render with no client check.
 */
export default function AccountWishlistPage() {
  if (!features.wishlist) notFound();
  return <WishlistView />;
}
