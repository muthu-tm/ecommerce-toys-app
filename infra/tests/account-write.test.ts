import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ProductDoc } from '@romp/contracts';
import { aProduct } from '@romp/contracts/fixtures';
import type { StoreContext } from '@romp/data';
import {
  addToWishlist,
  asCustomer,
  converters,
  createAddress,
  createStoreContext,
  deleteAddress,
  isWishlisted,
  listAddresses,
  listWishlist,
  removeFromWishlist,
  systemClock,
  updateAddress,
} from '@romp/data';
import { NotFoundError, ValidationFailedError } from '@romp/observability';

import { DEMO_PROJECT_ID } from './helpers/emulator';

/**
 * Account writes against real Firestore.
 *
 * The unit tests cover the branch logic; this proves it end to end against the converters and the
 * real subcollection queries: the single-default invariant holds across create/update/delete, a
 * create appends the account event, and the wishlist toggle round-trips with the product-existence
 * guard.
 */

let app: App;
let ctx: StoreContext;

beforeAll(() => {
  app = initializeApp({ projectId: DEMO_PROJECT_ID }, `account-write-${String(Date.now())}`);
  ctx = createStoreContext({ storeId: 'test-store', db: getFirestore(app), clock: systemClock });
});

afterAll(async () => {
  await deleteApp(app);
});

const uniqueId = (prefix: string): string =>
  `${prefix}-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

const addressInput = (label: string, isDefault: boolean) => ({
  label,
  recipientName: 'Asha Menon',
  line1: '12 Palm Grove',
  line2: null,
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  phone: '+919845021174',
  isDefault,
});

describe('address writes against Firestore', () => {
  it('keeps exactly one default across create, promote and delete', async () => {
    const uid = uniqueId('cust');
    const caller = asCustomer(uid);

    // First address is the default even though not requested.
    const home = await createAddress(ctx, caller, uid, addressInput('Home', false));
    let addresses = await listAddresses(ctx, caller, uid);
    expect(addresses).toHaveLength(1);
    expect(addresses[0]?.isDefault).toBe(true);

    // A second, non-default address leaves the first as default.
    const office = await createAddress(ctx, caller, uid, addressInput('Office', false));
    addresses = await listAddresses(ctx, caller, uid);
    expect(addresses.filter((a) => a.isDefault)).toHaveLength(1);
    expect(addresses.find((a) => a.id === home.id)?.isDefault).toBe(true);

    // Promoting the office demotes home.
    await updateAddress(ctx, caller, uid, office.id, { isDefault: true });
    addresses = await listAddresses(ctx, caller, uid);
    expect(addresses.find((a) => a.id === office.id)?.isDefault).toBe(true);
    expect(addresses.find((a) => a.id === home.id)?.isDefault).toBe(false);

    // The default cannot be deleted while another exists.
    await expect(deleteAddress(ctx, caller, uid, office.id)).rejects.toBeInstanceOf(
      ValidationFailedError,
    );

    // A non-default one deletes cleanly.
    await deleteAddress(ctx, caller, uid, home.id);
    addresses = await listAddresses(ctx, caller, uid);
    expect(addresses).toHaveLength(1);
    expect(addresses[0]?.id).toBe(office.id);
  });

  it('appends an account.address_added event on create', async () => {
    const uid = uniqueId('cust');
    await createAddress(ctx, asCustomer(uid), uid, addressInput('Home', true));

    const events = await ctx.db
      .collection('events')
      .where('type', '==', 'account.address_added')
      .where('subject.id', '==', uid)
      .get();
    expect(events.empty).toBe(false);
    expect(events.docs[0]?.data().payload).toMatchObject({ userId: uid, addressLabel: 'Home' });
  });

  it('refuses a foreign account', async () => {
    const uid = uniqueId('cust');
    await expect(
      createAddress(ctx, asCustomer('someone-else'), uid, addressInput('Home', true)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('wishlist writes against Firestore', () => {
  async function seedProduct(): Promise<string> {
    const slug = uniqueId('prod');
    await ctx.db
      .doc(`products/${slug}`)
      .withConverter(converters.products)
      .set(aProduct({ slug: slug as ProductDoc['slug'], status: 'active' }));
    return slug;
  }

  it('adds and removes a product, idempotently', async () => {
    const uid = uniqueId('cust');
    const caller = asCustomer(uid);
    const productId = await seedProduct();

    await addToWishlist(ctx, caller, productId);
    await addToWishlist(ctx, caller, productId); // idempotent
    expect(await isWishlisted(ctx, caller, productId)).toBe(true);
    expect(await listWishlist(ctx, caller, uid)).toHaveLength(1);

    await removeFromWishlist(ctx, caller, productId);
    await removeFromWishlist(ctx, caller, productId); // idempotent
    expect(await isWishlisted(ctx, caller, productId)).toBe(false);
  });

  it('404s adding a product that does not exist', async () => {
    const uid = uniqueId('cust');
    await expect(addToWishlist(ctx, asCustomer(uid), 'no-such-product')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
