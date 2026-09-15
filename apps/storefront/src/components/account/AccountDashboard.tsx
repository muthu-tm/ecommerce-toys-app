'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { MeResponse } from '@romp/contracts';
import { assessPassword } from '@romp/core';
import { Button, Card, Field } from '@romp/ui';

import { AccountApiError, accountApi } from '@/lib/account-api';
import { useAuth } from '@/lib/auth-context';
import { signOutCustomer } from '@/lib/firebase-client';
import { brand } from '@/lib/store';

import { SignedOut } from './SignedOut';

/**
 * The account dashboard: who you are, your name, your password, and sign out.
 *
 * Reads the profile through the API on mount (presence booleans, never the raw email or phone — the
 * server does not echo PII), lets the customer rename themselves, change their password (which
 * revokes every other session and lands a "password changed" in their own feed — takeover-visible),
 * and sign out. Signed out, it shows the shared prompt rather than an empty page.
 */
export function AccountDashboard() {
  const { uid, ready } = useAuth();
  const router = useRouter();

  const [me, setMe] = useState<MeResponse | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameMessage, setNameMessage] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (uid === null) return;
    void accountApi
      .me()
      .then((profile) => {
        setMe(profile);
        setDisplayName(profile.displayName);
      })
      .catch(() => {
        setMe(null);
      });
  }, [uid]);

  if (!ready) {
    return <p className="font-body text-text-muted">Loading…</p>;
  }
  if (uid === null) {
    return <SignedOut next="/account" />;
  }

  const saveName = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    setSavingName(true);
    setNameMessage(null);
    void accountApi
      .updateProfile({ displayName })
      .then((updated) => {
        setMe(updated);
        setNameMessage('Saved.');
      })
      .catch((cause: unknown) => {
        setNameMessage(cause instanceof AccountApiError ? cause.message : 'Could not save.');
      })
      .finally(() => {
        setSavingName(false);
      });
  };

  const assessment =
    newPassword === '' ? null : assessPassword(newPassword, { brandNames: [brand.name] });
  const weak = assessment !== null && !assessment.ok;

  const changePassword = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    if (weak) return;
    setSavingPassword(true);
    setPasswordMessage(null);
    setPasswordError(null);
    void accountApi
      .changePassword({ currentPassword, newPassword })
      .then(() => {
        setPasswordMessage('Password changed. Other sessions were signed out.');
        setCurrentPassword('');
        setNewPassword('');
      })
      .catch((cause: unknown) => {
        setPasswordError(
          cause instanceof AccountApiError ? cause.message : 'Could not change your password.',
        );
      })
      .finally(() => {
        setSavingPassword(false);
      });
  };

  const signOut = (): void => {
    void signOutCustomer().then(() => {
      router.push('/');
      router.refresh();
    });
  };

  return (
    <section className="flex flex-col gap-6" aria-labelledby="account-heading">
      <div className="flex items-center justify-between">
        <h1 id="account-heading" className="font-display text-2xl text-text-primary">
          Your account
        </h1>
        <Button variant="ghost" onClick={signOut}>
          Sign out
        </Button>
      </div>

      <nav aria-label="Account sections">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            { href: '/account/orders', label: 'Orders' },
            { href: '/account/addresses', label: 'Addresses' },
            { href: '/account/wishlist', label: 'Saved toys' },
            { href: '/account/reviews', label: 'Reviews' },
            { href: '/account/notifications', label: 'Notifications' },
          ].map((link) => (
            <li key={link.href}>
              <Card interactive className="h-full">
                <Link
                  href={link.href}
                  className="flex min-h-16 items-center justify-between gap-2 p-4 font-body font-semibold text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  {link.label}
                  <svg viewBox="0 0 20 20" className="size-4 text-text-muted" aria-hidden="true" fill="none">
                    <path
                      d="M7 4l6 6-6 6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      </nav>

      <Card className="p-6">
        <form onSubmit={saveName} className="flex flex-col gap-3">
          <Field
            label="Your name"
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
            }}
            required
          />
          {me !== null ? (
            <p className="font-body text-sm text-text-muted">
              Signed in with your {me.primaryIdentifierType === 'email' ? 'email' : 'mobile number'}
              .
            </p>
          ) : null}
          {nameMessage !== null ? (
            <p role="status" className="font-body text-sm text-text-muted">
              {nameMessage}
            </p>
          ) : null}
          <div>
            <Button type="submit" loading={savingName} disabled={savingName}>
              Save name
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-6">
        <form onSubmit={changePassword} className="flex flex-col gap-3">
          <h2 className="font-display text-lg text-text-primary">Change password</h2>
          <Field
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => {
              setCurrentPassword(event.target.value);
            }}
            required
          />
          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => {
              setNewPassword(event.target.value);
            }}
            required
            {...(weak && assessment.suggestions.length > 0
              ? { error: assessment.suggestions[0] }
              : {})}
          />
          {passwordMessage !== null ? (
            <p role="status" className="font-body text-sm text-text-muted">
              {passwordMessage}
            </p>
          ) : null}
          {passwordError !== null ? (
            <p role="alert" className="font-body text-sm text-danger">
              {passwordError}
            </p>
          ) : null}
          <div>
            <Button type="submit" loading={savingPassword} disabled={savingPassword || weak}>
              Change password
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}
