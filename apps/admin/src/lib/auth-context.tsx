'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { type OperatorCheck, fetchOperator } from './api';
import { onUidChanged } from './auth';

/**
 * The backoffice's app-wide auth state.
 *
 * Mirrors the storefront's `AuthProvider`, with one addition the admin needs and the customer
 * does not: the **operator claim check**. Being signed in is not enough to use the backoffice —
 * the account must carry the `owner`/`staff` role claim, which only the server can verify. So on
 * every sign-in change this fetches `GET /v1/admin/me` and exposes the result, and the guard
 * renders login / not-permitted / the app from it.
 *
 * `ready` is false only until the first auth callback lands. `operator` is null while the claim
 * check is in flight (so the guard shows a spinner rather than flashing the login screen), then
 * one of operator / forbidden / anonymous.
 */

export interface AdminAuthState {
  /** The signed-in uid, or null when signed out (or the SDK is unconfigured). */
  readonly uid: string | null;
  /** False until the first auth state has resolved; true thereafter. */
  readonly ready: boolean;
  /** The operator claim check, or null while it is being resolved. */
  readonly operator: OperatorCheck | null;
  /** Re-runs the claim check — used after a fresh sign-in so a new token's claim is picked up. */
  readonly refresh: () => void;
}

const AdminAuthContext = createContext<AdminAuthState>({
  uid: null,
  ready: false,
  operator: null,
  refresh: () => undefined,
});

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [uid, setUid] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [operator, setOperator] = useState<OperatorCheck | null>(null);

  const checkOperator = useCallback((currentUid: string | null): void => {
    if (currentUid === null) {
      setOperator({ kind: 'anonymous' });
      return;
    }
    // Null while in flight, so the guard shows a spinner rather than the login screen.
    setOperator(null);
    void fetchOperator()
      .then(setOperator)
      .catch(() => {
        setOperator({ kind: 'anonymous' });
      });
  }, []);

  useEffect(
    () =>
      onUidChanged((next) => {
        setUid(next);
        setReady(true);
        checkOperator(next);
      }),
    [checkOperator],
  );

  const refresh = useCallback(() => {
    checkOperator(uid);
  }, [checkOperator, uid]);

  const value = useMemo<AdminAuthState>(
    () => ({ uid, ready, operator, refresh }),
    [uid, ready, operator, refresh],
  );
  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

/** The current backoffice auth state, from the nearest `AuthProvider`. */
export function useAuth(): AdminAuthState {
  return useContext(AdminAuthContext);
}
