import { ButtonLink, Card } from '@romp/ui';

/**
 * The signed-out affordance shared by every account page.
 *
 * An account page needs a signed-in customer; when there is none, this is what shows — a clear
 * prompt to sign in that returns to where they were, rather than an empty screen or a redirect loop.
 * `next` carries the path back so the sign-in form can send them onward.
 */
export function SignedOut({ next, message }: { readonly next: string; readonly message?: string }) {
  return (
    <Card className="mx-auto flex max-w-md flex-col items-center gap-4 p-10 text-center">
      <span
        aria-hidden="true"
        className="inline-flex size-14 items-center justify-center rounded-pill bg-surface-alt text-text-muted"
      >
        <svg viewBox="0 0 24 24" className="size-7" fill="none">
          <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />
          <path
            d="M5 20c1.6-3.5 4.6-5 7-5s5.4 1.5 7 5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <p className="font-body text-text-secondary">{message ?? 'Sign in to see your account.'}</p>
      <ButtonLink href={`/account/sign-in?next=${encodeURIComponent(next)}`}>Sign in</ButtonLink>
    </Card>
  );
}
