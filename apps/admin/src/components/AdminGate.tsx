'use client';

import type { ReactNode } from 'react';

import { Button, Card, Spinner } from '@romp/ui';

import { LoginForm } from '@/components/LoginForm';
import { signOutOperator } from '@/lib/auth';
import { useAuth } from '@/lib/auth-context';
import { brand } from '@/lib/store';

/**
 * The backoffice access gate.
 *
 * Wraps the whole app inside the shell. It renders one of four states from the auth context:
 *
 *  - **checking** — auth not resolved yet, or the operator claim is still being verified. A
 *    spinner, so the login screen never flashes before we know who is signed in.
 *  - **anonymous** — nobody signed in. The centred login card.
 *  - **forbidden** — signed in, but the account has no operator claim. A clear "this area is
 *    for store staff" notice with a sign-out, not a redirect loop and not a blank screen —
 *    exactly the distinction `docs/IDENTITY.md` requires.
 *  - **operator** — the claim is present; render the backoffice.
 *
 * The gate is client-side and deliberately not a security boundary on its own: every write
 * still crosses the API, which verifies the claim server-side on every request. This is the
 * UX layer that keeps a non-operator from staring at controls that would only 401/403.
 */
export function AdminGate({ children }: { readonly children: ReactNode }) {
  const { ready, operator } = useAuth();

  // Not resolved yet, or the claim check is in flight.
  if (!ready || operator === null) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center">
        <Spinner label="Loading" />
      </div>
    );
  }

  if (operator.kind === 'operator') {
    return <>{children}</>;
  }

  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md items-center">
      <Card className="w-full bg-surface-elevated p-8">
        {operator.kind === 'forbidden' ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <h1 className="font-display text-2xl text-text-primary">This area is for store staff</h1>
            <p className="font-body text-text-secondary">
              You’re signed in, but this account can’t manage {brand.name}. If you believe this is a
              mistake, ask an owner to grant you access.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                void signOutOperator();
              }}
            >
              Sign out
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1 text-center">
              <h1 id="admin-signin-heading" className="font-display text-2xl text-text-primary">
                {brand.name} Backoffice
              </h1>
              <p className="font-body text-sm text-text-secondary">Sign in to manage the store.</p>
            </div>
            <LoginForm />
          </div>
        )}
      </Card>
    </div>
  );
}
