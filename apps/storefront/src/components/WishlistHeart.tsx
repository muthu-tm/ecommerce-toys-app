'use client';

import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';

import { IconButton } from '@romp/ui';

import { AccountApiError, accountApi } from '@/lib/account-api';
import { useAuth } from '@/lib/auth-context';
import { firestoreClient } from '@/lib/firebase-client';

/**
 * The wishlist heart on a product page.
 *
 * A client island because the wishlist is per-customer state the server-rendered page (read as an
 * anonymous visitor) cannot know. On mount, for a signed-in customer, it reads whether this product
 * is already saved directly from Firestore under the rules — the same client-read seam the checkout
 * address picker uses — and reflects it. The toggle writes through the API, which is the only write
 * path; the local state flips optimistically and reverts if the write fails.
 *
 * Signed out, the heart is a link to sign in — saving needs an account, and that is an honest
 * affordance rather than a control that silently does nothing. The whole component renders only when
 * the store has the wishlist feature on; the page gates it.
 */
export function WishlistHeart({ productId }: { readonly productId: string }) {
  const { uid, ready } = useAuth();
  const [saved, setSaved] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const db = firestoreClient();
    if (uid === null || db === null) {
      setSaved(null);
      return;
    }
    let active = true;
    void getDoc(doc(db, 'users', uid, 'wishlist', productId))
      .then((snap) => {
        if (active) setSaved(snap.exists());
      })
      .catch(() => {
        if (active) setSaved(false);
      });
    return () => {
      active = false;
    };
  }, [uid, productId]);

  // Signed out (or auth not yet resolved): a link to sign in, returning to this product.
  if (!ready || uid === null) {
    return (
      <a
        href={`/account/sign-in?next=${encodeURIComponent(`/p/${productId}`)}`}
        aria-label="Sign in to save this toy"
        className="inline-flex size-11 items-center justify-center rounded-md text-text-primary hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <HeartIcon filled={false} />
      </a>
    );
  }

  const toggle = (): void => {
    if (saved === null) return;
    const next = !saved;
    setSaved(next);
    setPending(true);
    const call = next
      ? accountApi.addToWishlist(productId)
      : accountApi.removeFromWishlist(productId);
    void call
      .catch((cause: unknown) => {
        // Revert on failure — the heart must not claim a save that did not happen.
        setSaved(!next);
        if (!(cause instanceof AccountApiError)) throw cause;
      })
      .finally(() => {
        setPending(false);
      });
  };

  return (
    <IconButton
      label={saved === true ? 'Remove from saved toys' : 'Save this toy'}
      aria-pressed={saved === true}
      disabled={pending || saved === null}
      onClick={toggle}
    >
      <HeartIcon filled={saved === true} />
    </IconButton>
  );
}

function HeartIcon({ filled }: { readonly filled: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className="size-5"
      aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
    >
      <path
        d="M10 16S3.5 12 3.5 7.8A3.3 3.3 0 0110 6a3.3 3.3 0 016.5 1.8C16.5 12 10 16 10 16z"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}
