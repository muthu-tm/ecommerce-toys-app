'use client';

import { useState } from 'react';

import { Button, Field } from '@romp/ui';

import { signInWithIdentifier } from '@/lib/auth';
import { useAuth } from '@/lib/auth-context';
import { brand, locale } from '@/lib/store';

/**
 * The operator sign-in form.
 *
 * Login-only — the backoffice has no registration, because admins are seeded, never
 * self-created (`docs/IDENTITY.md`). Takes an email or a mobile number and a password,
 * normalised with the same `@romp/core` helpers the seed used, and signs in through Firebase.
 * On success it refreshes the auth context's operator check, which flips the guard from the
 * login screen to either the backoffice (claim present) or the "for store staff" notice (a
 * valid account without the claim).
 *
 * The failure message is deliberately singular and non-enumerating — a wrong password and an
 * unknown account read the same — and the sign-in failures are the surface `IDENTITY.md` says
 * to log by identifier *type* only, never the value.
 */
export function LoginForm() {
  const { refresh } = useAuth();
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
        // The auth context's onUidChanged will fire and re-check the claim, but refresh()
        // makes the transition immediate rather than waiting on the listener.
        refresh();
      })
      .catch(() => {
        setError('That email or mobile number and password did not match. Try again.');
        setPending(false);
      });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-labelledby="admin-signin-heading">
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

      <Button type="submit" fullWidth loading={pending} disabled={pending}>
        Sign in
      </Button>
    </form>
  );
}
