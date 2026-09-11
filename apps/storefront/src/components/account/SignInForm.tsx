'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Field } from '@romp/ui';

import { signInWithIdentifier } from '@/lib/firebase-client';
import { brand, locale } from '@/lib/store';

/**
 * The customer sign-in form.
 *
 * Takes an email or a mobile number and a password. The identifier is normalised with the same
 * `@romp/core` helpers the server used at registration, so the login alias matches the account —
 * that logic lives in `signInWithIdentifier`. On success the customer lands where they were headed
 * (`next`) or on their account; a bad credential shows a single, non-enumerating message.
 */
export function SignInForm({ next }: { readonly next?: string }) {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    setPending(true);
    setError(null);
    void signInWithIdentifier(identifier, password, {
      storeId: brand.id,
      defaultRegion: locale.defaultPhoneRegion,
    })
      .then(() => {
        router.push(next ?? '/account');
        router.refresh();
      })
      .catch(() => {
        // Deliberately one message for every failure — a wrong password and an unknown account read
        // the same, so the form is not an account-enumeration oracle.
        setError('That email or mobile number and password did not match. Try again.');
      })
      .finally(() => {
        setPending(false);
      });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-labelledby="signin-heading">
      <h1 id="signin-heading" className="font-display text-2xl text-text-primary">
        Sign in
      </h1>

      <Field
        label="Email or mobile number"
        type="text"
        autoComplete="username"
        value={identifier}
        onChange={(event) => {
          setIdentifier(event.target.value);
        }}
        required
      />
      <Field
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
        }}
        required
      />

      {error !== null ? (
        <p role="alert" className="font-body text-sm text-danger">
          {error}
        </p>
      ) : null}

      <Button type="submit" loading={pending} disabled={pending}>
        Sign in
      </Button>

      <p className="font-body text-sm text-text-muted">
        New here?{' '}
        <Link href="/account/register" className="text-accent underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
