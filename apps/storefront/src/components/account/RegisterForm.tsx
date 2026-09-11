'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { assessPassword } from '@romp/core';
import { Button, Field } from '@romp/ui';

import { AccountApiError, accountApi } from '@/lib/account-api';
import { signInWithIdentifier } from '@/lib/firebase-client';
import { brand, locale } from '@/lib/store';

/**
 * The customer registration form.
 *
 * Creates the account through the API (the one write that reserves the identifier and creates the
 * profile atomically), then signs in immediately with the same credentials. The password strength
 * is assessed client-side with the same `@romp/core` policy the server enforces, so the customer
 * sees the suggestions before submitting rather than after a rejection. A taken identifier gets the
 * server's own message.
 */
export function RegisterForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assessment =
    password === '' ? null : assessPassword(password, { brandNames: [brand.name] });
  const weak = assessment !== null && !assessment.ok;

  const submit = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    if (weak) return;
    setPending(true);
    setError(null);
    void accountApi
      .register({ identifier, password, displayName })
      .then(() =>
        signInWithIdentifier(identifier, password, {
          storeId: brand.id,
          defaultRegion: locale.defaultPhoneRegion,
        }),
      )
      .then(() => {
        router.push('/account');
        router.refresh();
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof AccountApiError ? cause.message : 'We could not create your account.',
        );
      })
      .finally(() => {
        setPending(false);
      });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-labelledby="register-heading">
      <h1 id="register-heading" className="font-display text-2xl text-text-primary">
        Create an account
      </h1>

      <Field
        label="Your name"
        type="text"
        autoComplete="name"
        value={displayName}
        onChange={(event) => {
          setDisplayName(event.target.value);
        }}
        required
      />
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
        autoComplete="new-password"
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
        }}
        required
        {...(weak && assessment.suggestions.length > 0 ? { error: assessment.suggestions[0] } : {})}
      />

      {error !== null ? (
        <p role="alert" className="font-body text-sm text-danger">
          {error}
        </p>
      ) : null}

      <Button type="submit" loading={pending} disabled={pending || weak}>
        Create account
      </Button>

      <p className="font-body text-sm text-text-muted">
        Already have an account?{' '}
        <Link href="/account/sign-in" className="text-accent underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
