'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { onUidChanged } from './firebase-client';

/**
 * The app-wide customer auth state.
 *
 * One subscription to sign-in changes, shared through context, so every feature reads the same
 * `{ uid, ready }` rather than each wiring its own `onUidChanged` (the pattern the checkout page and
 * the bell used before this existed). `ready` is false only until the first auth callback lands —
 * so a page can show a spinner rather than flashing the signed-out state before the SDK resolves who
 * is signed in.
 *
 * A client provider mounted in the root layout wraps the whole tree, header included, so the
 * notification bell and the account pages share one source of truth for the current uid.
 */

export interface AuthState {
  /** The signed-in customer's uid, or null when signed out (or the SDK is unconfigured). */
  readonly uid: string | null;
  /** False until the first auth state has resolved; true thereafter. */
  readonly ready: boolean;
}

const AuthContext = createContext<AuthState>({ uid: null, ready: false });

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [uid, setUid] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(
    () =>
      onUidChanged((next) => {
        setUid(next);
        setReady(true);
      }),
    [],
  );

  const value = useMemo<AuthState>(() => ({ uid, ready }), [uid, ready]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** The current customer auth state, from the nearest `AuthProvider`. */
export function useAuth(): AuthState {
  return useContext(AuthContext);
}
