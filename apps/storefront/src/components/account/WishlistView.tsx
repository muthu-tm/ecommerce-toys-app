'use client';

import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Button, Card } from '@romp/ui';

import { AccountApiError, accountApi } from '@/lib/account-api';
import { useAuth } from '@/lib/auth-context';
import { firestoreClient } from '@/lib/firebase-client';
import { content } from '@/lib/store';

import { SignedOut } from './SignedOut';

/**
 * The customer's saved toys.
 *
 * Reads the wishlist directly from Firestore under the rules; removal goes through the API. The list
 * holds product IDs (the document ID is the product ID), each linking to its page. The empty state
 * is the store's own copy. Rendered only where the store has the wishlist feature on — the page
 * gates it.
 */
export function WishlistView() {
  const { uid, ready } = useAuth();
  const [productIds, setProductIds] = useState<readonly string[]>([]);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const db = firestoreClient();
    if (uid === null || db === null) {
      setProductIds([]);
      return;
    }
    const snap = await getDocs(
      query(collection(db, 'users', uid, 'wishlist'), orderBy('addedAt', 'desc')),
    );
    setProductIds(snap.docs.map((doc) => doc.id));
  }, [uid]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ready) return <p className="font-body text-text-muted">Loading…</p>;
  if (uid === null)
    return <SignedOut next="/account/wishlist" message="Sign in to see your saved toys." />;

  const empty = content.emptyStates.emptyWishlist;

  const remove = (productId: string): void => {
    setPending(productId);
    void accountApi
      .removeFromWishlist(productId)
      .then(() => load())
      .catch((cause: unknown) => {
        if (!(cause instanceof AccountApiError)) throw cause;
      })
      .finally(() => {
        setPending(null);
      });
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="wishlist-heading">
      <h1 id="wishlist-heading" className="font-display text-2xl text-text-primary">
        Saved toys
      </h1>

      {productIds.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-display text-base text-text-primary">{empty.title}</p>
          <p className="mt-1 font-body text-sm text-text-muted">{empty.body}</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {productIds.map((productId) => (
            <li key={productId}>
              <Card className="flex items-center justify-between gap-3 p-4">
                <Link href={`/p/${productId}`} className="font-body text-text-primary underline">
                  {productId}
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={pending === productId}
                  disabled={pending !== null}
                  onClick={() => {
                    remove(productId);
                  }}
                >
                  Remove
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
