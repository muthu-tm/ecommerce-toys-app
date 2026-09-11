'use client';

import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { useEffect, useState } from 'react';

import { firestoreClient, onUidChanged } from './firebase-client';

/**
 * The signed-in customer's saved addresses, for the checkout address picker.
 *
 * Addresses are client-READ and API-WRITTEN (`firestore.rules`): a customer may read their own
 * `users/{uid}/addresses` under the rules, exactly as the account pages do, but cannot write them
 * from the browser. So the checkout page reads them directly through the client SDK rather than
 * through an API round trip — there is no address-list endpoint, and address creation is a later
 * task. Default first, then newest, matching the server's ordering, so the preselected address is
 * the first element.
 *
 * Until client auth (Task 20) wires a real sign-in surface, `uid` is resolved from the client SDK's
 * current user; a signed-out visitor sees the empty, not-signed-in state and the page asks them to
 * sign in rather than throwing.
 */

export interface CheckoutAddress {
  readonly id: string;
  readonly label: string;
  readonly recipientName: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly state: string;
  readonly pincode: string;
  readonly isDefault: boolean;
}

export interface CheckoutSession {
  /** The signed-in customer's uid, or null while signed out or before auth resolves. */
  readonly uid: string | null;
  /** Whether the auth state and addresses have been resolved (false while loading). */
  readonly ready: boolean;
  readonly addresses: readonly CheckoutAddress[];
}

interface RawAddress {
  readonly label?: unknown;
  readonly recipientName?: unknown;
  readonly line1?: unknown;
  readonly line2?: unknown;
  readonly city?: unknown;
  readonly state?: unknown;
  readonly pincode?: unknown;
  readonly isDefault?: unknown;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

export function useCheckoutSession(): CheckoutSession {
  const [uid, setUid] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<readonly CheckoutAddress[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => onUidChanged(setUid), []);

  useEffect(() => {
    const db = firestoreClient();
    if (uid === null || db === null) {
      setAddresses([]);
      setReady(true);
      return;
    }

    let active = true;
    setReady(false);
    const addressQuery = query(
      collection(db, 'users', uid, 'addresses'),
      orderBy('isDefault', 'desc'),
      orderBy('createdAt', 'desc'),
    );
    void getDocs(addressQuery)
      .then((snapshot) => {
        if (!active) return;
        setAddresses(
          snapshot.docs.map((snap) => {
            const data = snap.data() as RawAddress;
            return {
              id: snap.id,
              label: str(data.label),
              recipientName: str(data.recipientName),
              line1: str(data.line1),
              line2: typeof data.line2 === 'string' ? data.line2 : null,
              city: str(data.city),
              state: str(data.state),
              pincode: str(data.pincode),
              isDefault: data.isDefault === true,
            };
          }),
        );
      })
      .catch(() => {
        if (active) setAddresses([]);
      })
      .finally(() => {
        if (active) setReady(true);
      });

    return () => {
      active = false;
    };
  }, [uid]);

  return { uid, ready, addresses };
}
