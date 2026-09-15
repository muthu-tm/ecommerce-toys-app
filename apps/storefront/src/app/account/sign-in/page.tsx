import { AuthShell } from '@/components/account/AuthShell';
import { SignInForm } from '@/components/account/SignInForm';

/**
 * The sign-in page.
 *
 * A thin server shell over the client form. `next` lets a guarded page send a signed-out visitor
 * here and back — the checkout "sign in to continue" link carries where to return to.
 */
export const metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = typeof params.next === 'string' ? params.next : undefined;

  return (
    <AuthShell>
      <SignInForm {...(next === undefined ? {} : { next })} />
    </AuthShell>
  );
}
