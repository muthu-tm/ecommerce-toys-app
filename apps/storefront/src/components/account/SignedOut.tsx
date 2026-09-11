import Link from 'next/link';

import { Card } from '@romp/ui';

/**
 * The signed-out affordance shared by every account page.
 *
 * An account page needs a signed-in customer; when there is none, this is what shows — a clear
 * prompt to sign in that returns to where they were, rather than an empty screen or a redirect loop.
 * `next` carries the path back so the sign-in form can send them onward.
 */
export function SignedOut({ next, message }: { readonly next: string; readonly message?: string }) {
  return (
    <Card className="mx-auto max-w-md p-8 text-center">
      <p className="font-body text-text-primary">{message ?? 'Sign in to see your account.'}</p>
      <p className="mt-4">
        <Link
          href={`/account/sign-in?next=${encodeURIComponent(next)}`}
          className="text-accent underline"
        >
          Sign in
        </Link>
      </p>
    </Card>
  );
}
