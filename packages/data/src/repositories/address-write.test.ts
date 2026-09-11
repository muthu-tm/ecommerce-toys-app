import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import type { AddressDoc } from '@romp/contracts';
import { anAddress } from '@romp/contracts/fixtures';
import { NotFoundError, ValidationFailedError } from '@romp/observability';

import { fixedClock } from '../clock';
import { asCustomer, asOperator, createStoreContext } from '../context';
import type { StoreContext } from '../context';
import { converters } from '../converters';

import { createAddress, deleteAddress, updateAddress } from './address-write';

/**
 * Unit tests for address writes.
 *
 * A stateful Firestore double asserts the two invariants the API owns: exactly one default (a new
 * or promoted default demotes the others), and a default that cannot be deleted out from under that
 * invariant. It also proves a create appends an `account.address_added` event, and that a foreign
 * caller is refused.
 */

const NOW = new Date('2026-03-01T12:00:00.000Z');
const UID = 'cust-1';
const CUSTOMER = asCustomer(UID);

interface StoredDoc {
  readonly path: string;
  data: Record<string, unknown>;
}

interface Converter {
  toFirestore: (v: unknown) => Record<string, unknown>;
  fromFirestore: (s: { id: string; data: () => unknown }) => unknown;
}

/**
 * A Firestore double supporting: collection query `get()` (returns seeded docs under a path
 * prefix), collection `doc()` auto-id, doc `get()`, and transaction `get`/`set`/`update`/`delete`.
 */
function fakeDb(seed: readonly StoredDoc[] = []) {
  const store = new Map<string, Record<string, unknown>>(seed.map((d) => [d.path, d.data]));
  let generated = 0;

  const decode = (
    path: string,
    raw: Record<string, unknown> | undefined,
    converter: Converter | null,
  ) =>
    raw === undefined || converter === null
      ? raw
      : (converter.fromFirestore({ id: path.split('/').at(-1) ?? '', data: () => raw }) as Record<
          string,
          unknown
        >);

  const docRef = (path: string) => {
    let converter: Converter | null = null;
    const ref = {
      path,
      id: path.split('/').at(-1) ?? '',
      withConverter: (c: Converter) => {
        converter = c;
        return ref;
      },
      get converter() {
        return converter;
      },
      get: () =>
        Promise.resolve({
          id: ref.id,
          exists: store.get(path) !== undefined,
          data: () => decode(path, store.get(path), converter),
        }),
      delete: () => {
        store.delete(path);
        return Promise.resolve();
      },
    };
    return ref;
  };

  const collectionRef = (path: string) => {
    let converter: Converter | null = null;
    const ref = {
      path,
      withConverter: (c: Converter) => {
        converter = c;
        return ref;
      },
      get converter() {
        return converter;
      },
      doc: () => {
        generated += 1;
        const d = docRef(`${path}/generated-${String(generated)}`);
        return converter === null ? d : d.withConverter(converter);
      },
      get: () => {
        const docs = [...store.entries()]
          .filter(
            ([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'),
          )
          .map(([key, raw]) => ({
            id: key.split('/').at(-1) ?? '',
            ref: docRef(key).withConverter(converter!),
            data: () => decode(key, raw, converter),
          }));
        return Promise.resolve({ empty: docs.length === 0, size: docs.length, docs });
      },
    };
    return ref;
  };

  interface Ref {
    path: string;
    converter: Converter | null;
  }

  const runTransaction = async <T>(
    fn: (tx: {
      get: (ref: Ref) => Promise<unknown>;
      set: (ref: Ref, data: unknown) => void;
      update: (ref: Ref, patch: Record<string, unknown>) => void;
      delete: (ref: Ref) => void;
    }) => Promise<T>,
  ): Promise<T> => {
    const staged: {
      op: 'set' | 'update' | 'delete';
      path: string;
      data?: Record<string, unknown>;
    }[] = [];
    const tx = {
      get: (ref: Ref & { get: () => Promise<unknown> }) => ref.get(),
      set: (ref: Ref, data: unknown) => {
        staged.push({
          op: 'set',
          path: ref.path,
          data: (ref.converter === null ? data : ref.converter.toFirestore(data)) as Record<
            string,
            unknown
          >,
        });
      },
      update: (ref: Ref, patch: Record<string, unknown>) => {
        staged.push({ op: 'update', path: ref.path, data: patch });
      },
      delete: (ref: Ref) => {
        staged.push({ op: 'delete', path: ref.path });
      },
    };
    const result = await fn(tx as never);
    for (const w of staged) {
      if (w.op === 'delete') store.delete(w.path);
      else if (w.op === 'update') store.set(w.path, { ...(store.get(w.path) ?? {}), ...w.data });
      else store.set(w.path, w.data ?? {});
    }
    return result;
  };

  const db = { doc: docRef, collection: collectionRef, runTransaction } as unknown as Firestore;
  return { db, store };
}

function ctxWith(db: Firestore): StoreContext {
  return createStoreContext({ storeId: 'test-store', db, clock: fixedClock(NOW) });
}

function seedAddress(id: string, overrides: Partial<AddressDoc> = {}): StoredDoc {
  return {
    path: `users/${UID}/addresses/${id}`,
    data: converters.addresses.toFirestore(anAddress(overrides)),
  };
}

const input = {
  label: 'Office',
  recipientName: 'Asha Menon',
  line1: '9 MG Road',
  line2: null,
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  phone: '+919845021174',
  isDefault: false,
} as const;

function eventCount(store: Map<string, Record<string, unknown>>): number {
  return [...store.keys()].filter((key) => key.startsWith('events/')).length;
}

describe('createAddress', () => {
  it('makes the first address the default even if not requested', async () => {
    const { db, store } = fakeDb([]);
    const { id } = await createAddress(ctxWith(db), CUSTOMER, UID, { ...input, isDefault: false });
    const created = store.get(`users/${UID}/addresses/${id}`);
    expect(created?.isDefault).toBe(true);
    // The create appended an account.address_added event.
    expect(eventCount(store)).toBe(1);
  });

  it('demotes the previous default when a new default is added', async () => {
    const { db, store } = fakeDb([seedAddress('home', { isDefault: true })]);
    const { id } = await createAddress(ctxWith(db), CUSTOMER, UID, { ...input, isDefault: true });

    expect(store.get(`users/${UID}/addresses/${id}`)?.isDefault).toBe(true);
    expect(store.get(`users/${UID}/addresses/home`)?.isDefault).toBe(false);
  });

  it('keeps the existing default when the new address is not default', async () => {
    const { db, store } = fakeDb([seedAddress('home', { isDefault: true })]);
    const { id } = await createAddress(ctxWith(db), CUSTOMER, UID, { ...input, isDefault: false });

    expect(store.get(`users/${UID}/addresses/${id}`)?.isDefault).toBe(false);
    expect(store.get(`users/${UID}/addresses/home`)?.isDefault).toBe(true);
  });

  it('refuses a foreign account', async () => {
    const { db } = fakeDb([]);
    await expect(
      createAddress(ctxWith(db), asCustomer('other'), UID, input),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lets staff be refused too — writing another account is out of scope', async () => {
    const { db } = fakeDb([]);
    await expect(
      createAddress(ctxWith(db), asOperator('staff-1', 'staff'), UID, input),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('updateAddress', () => {
  it('promotes an address to default and demotes the others', async () => {
    const { db, store } = fakeDb([
      seedAddress('home', { isDefault: true }),
      seedAddress('office', { isDefault: false, label: 'Office' }),
    ]);
    await updateAddress(ctxWith(db), CUSTOMER, UID, 'office', { isDefault: true });

    expect(store.get(`users/${UID}/addresses/office`)?.isDefault).toBe(true);
    expect(store.get(`users/${UID}/addresses/home`)?.isDefault).toBe(false);
  });

  it('edits fields without touching the default', async () => {
    const { db, store } = fakeDb([seedAddress('home', { isDefault: true })]);
    await updateAddress(ctxWith(db), CUSTOMER, UID, 'home', { label: 'Renamed' });
    expect(store.get(`users/${UID}/addresses/home`)?.label).toBe('Renamed');
    expect(store.get(`users/${UID}/addresses/home`)?.isDefault).toBe(true);
  });

  it('404s a missing address', async () => {
    const { db } = fakeDb([]);
    await expect(
      updateAddress(ctxWith(db), CUSTOMER, UID, 'nope', { label: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('deleteAddress', () => {
  it('deletes a non-default address', async () => {
    const { db, store } = fakeDb([
      seedAddress('home', { isDefault: true }),
      seedAddress('office', { isDefault: false, label: 'Office' }),
    ]);
    await deleteAddress(ctxWith(db), CUSTOMER, UID, 'office');
    expect(store.get(`users/${UID}/addresses/office`)).toBeUndefined();
  });

  it('refuses to delete the default while other addresses exist', async () => {
    const { db } = fakeDb([
      seedAddress('home', { isDefault: true }),
      seedAddress('office', { isDefault: false, label: 'Office' }),
    ]);
    await expect(deleteAddress(ctxWith(db), CUSTOMER, UID, 'home')).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
  });

  it('deletes the only address (which is the default)', async () => {
    const { db, store } = fakeDb([seedAddress('home', { isDefault: true })]);
    await deleteAddress(ctxWith(db), CUSTOMER, UID, 'home');
    expect(store.get(`users/${UID}/addresses/home`)).toBeUndefined();
  });
});
