'use client';

import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';

import { Badge, Button, Card, Field } from '@romp/ui';

import { AccountApiError, accountApi } from '@/lib/account-api';
import { useAuth } from '@/lib/auth-context';
import { firestoreClient } from '@/lib/firebase-client';

import { SignedOut } from './SignedOut';

/**
 * The customer's address book.
 *
 * Reads their addresses directly from Firestore under the rules (the client-read seam), and writes —
 * add, promote-to-default, delete — through the API, which holds the "exactly one default, never
 * zero" invariant. The default cannot be deleted while another exists; the server refuses it and the
 * message shows. After any write the list is re-read so the server-decided default is reflected.
 */

interface Row {
  readonly id: string;
  readonly label: string;
  readonly recipientName: string;
  readonly line1: string;
  readonly city: string;
  readonly pincode: string;
  readonly isDefault: boolean;
}

const EMPTY_FORM = {
  label: '',
  recipientName: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  pincode: '',
  phone: '',
};

export function AddressBook() {
  const { uid, ready } = useAuth();
  const [rows, setRows] = useState<readonly Row[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const db = firestoreClient();
    if (uid === null || db === null) {
      setRows([]);
      return;
    }
    const snap = await getDocs(
      query(
        collection(db, 'users', uid, 'addresses'),
        orderBy('isDefault', 'desc'),
        orderBy('createdAt', 'desc'),
      ),
    );
    setRows(
      snap.docs.map((doc) => {
        const data = doc.data() as Record<string, unknown>;
        const str = (v: unknown): string => (typeof v === 'string' ? v : '');
        return {
          id: doc.id,
          label: str(data.label),
          recipientName: str(data.recipientName),
          line1: str(data.line1),
          city: str(data.city),
          pincode: str(data.pincode),
          isDefault: data.isDefault === true,
        };
      }),
    );
  }, [uid]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ready) return <p className="font-body text-text-muted">Loading…</p>;
  if (uid === null)
    return <SignedOut next="/account/addresses" message="Sign in to manage your addresses." />;

  const set = (key: keyof typeof EMPTY_FORM) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  const run = (action: () => Promise<unknown>): void => {
    setPending(true);
    setError(null);
    void action()
      .then(() => load())
      .catch((cause: unknown) => {
        setError(cause instanceof AccountApiError ? cause.message : 'That could not be done.');
      })
      .finally(() => {
        setPending(false);
      });
  };

  const add = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    run(() =>
      accountApi
        .createAddress({
          label: form.label,
          recipientName: form.recipientName,
          line1: form.line1,
          line2: form.line2 === '' ? null : form.line2,
          city: form.city,
          state: form.state,
          pincode: form.pincode,
          phone: form.phone,
          isDefault: rows.length === 0,
        })
        .then(() => {
          setForm(EMPTY_FORM);
        }),
    );
  };

  return (
    <section className="flex flex-col gap-6" aria-labelledby="addresses-heading">
      <h1 id="addresses-heading" className="font-display text-2xl text-text-primary">
        Your addresses
      </h1>

      {rows.length === 0 ? (
        <p className="font-body text-text-muted">No saved addresses yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id}>
              <Card className="flex items-center justify-between gap-3 p-4">
                <span className="flex flex-col">
                  <span className="flex items-center gap-2 font-body font-semibold text-text-primary">
                    {row.label}
                    {row.isDefault ? <Badge tone="accent">Default</Badge> : null}
                  </span>
                  <span className="font-body text-sm text-text-muted">
                    {row.recipientName} · {row.line1}, {row.city} {row.pincode}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {!row.isDefault ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        run(() => accountApi.updateAddress(row.id, { isDefault: true }));
                      }}
                    >
                      Make default
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      run(() => accountApi.deleteAddress(row.id));
                    }}
                  >
                    Delete
                  </Button>
                </span>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card className="p-6">
        <form onSubmit={add} className="flex flex-col gap-3" aria-labelledby="add-address">
          <h2 id="add-address" className="font-display text-lg text-text-primary">
            Add an address
          </h2>
          <Field label="Label" value={form.label} onChange={set('label')} required />
          <Field
            label="Recipient name"
            value={form.recipientName}
            onChange={set('recipientName')}
            required
          />
          <Field label="Address line 1" value={form.line1} onChange={set('line1')} required />
          <Field label="Address line 2" value={form.line2} onChange={set('line2')} />
          <Field label="City" value={form.city} onChange={set('city')} required />
          <Field label="State" value={form.state} onChange={set('state')} required />
          <Field label="PIN code" value={form.pincode} onChange={set('pincode')} required />
          <Field label="Contact number" value={form.phone} onChange={set('phone')} required />
          {error !== null ? (
            <p role="alert" className="font-body text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div>
            <Button type="submit" loading={pending} disabled={pending}>
              Save address
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}
