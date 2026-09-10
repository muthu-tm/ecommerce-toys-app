import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getBytes, ref, uploadBytes } from 'firebase/storage';
import type { FirebaseStorage } from 'firebase/storage';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { DEMO_PROJECT_ID, readRules, requireEmulatorEndpoint } from './helpers/emulator';

/**
 * The storage matrix from `SECURITY.md` § 3.
 *
 * | Path                                  | Read          | Write                        |
 * | ------------------------------------- | ------------- | ---------------------------- |
 * | products/{productId}/{file}           | public        | staff, <= 5 MB, image types  |
 * | payment-proofs/{orderId}/{uid}/{file} | owner + staff | owner only, <= 5 MB, + PDF   |
 * | store-assets/**                       | public        | nobody (deploy pipeline)     |
 *
 * The content-type checks here are checks on a **claim**. The client says what it is
 * uploading, and the only thing in this file that cannot be lied about is the size.
 * That is why the authoritative check is a finalize Function that re-derives the type
 * from magic bytes — these rules keep obvious abuse off the bucket, they do not
 * establish what a file is.
 */

const CUSTOMER_UID = 'customer-uid-0001';
const OTHER_CUSTOMER_UID = 'customer-uid-0002';
const STAFF_UID = 'staff-uid-0001';

let env: RulesTestEnvironment;

const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const imageMetadata = { contentType: 'image/png' };

const storageFor = (context: { storage: () => unknown }): FirebaseStorage =>
  context.storage() as FirebaseStorage;

const anonymous = () => storageFor(env.unauthenticatedContext());
const customer = () => storageFor(env.authenticatedContext(CUSTOMER_UID));
const otherCustomer = () => storageFor(env.authenticatedContext(OTHER_CUSTOMER_UID));
const staff = () => storageFor(env.authenticatedContext(STAFF_UID, { role: 'staff' }));
const owner = () => storageFor(env.authenticatedContext('owner-uid-0001', { role: 'owner' }));
const impostor = () => storageFor(env.authenticatedContext('impostor-uid', { role: 'superuser' }));

beforeAll(async () => {
  const storage = requireEmulatorEndpoint('FIREBASE_STORAGE_EMULATOR_HOST');

  env = await initializeTestEnvironment({
    projectId: DEMO_PROJECT_ID,
    storage: {
      rules: readRules('storage.rules'),
      host: storage.host,
      port: storage.port,
    },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearStorage();
  // Objects have to exist before a read can be denied for the right reason: reading a
  // missing object fails with `object-not-found`, which is not the failure under test.
  await env.withSecurityRulesDisabled(async (context) => {
    const admin = storageFor(context);
    await uploadBytes(ref(admin, 'products/p1/cover.png'), png(), imageMetadata);
    await uploadBytes(
      ref(admin, `payment-proofs/order-1/${CUSTOMER_UID}/proof.png`),
      png(),
      imageMetadata,
    );
    await uploadBytes(ref(admin, 'store-assets/logo-dark.png'), png(), imageMetadata);
    await uploadBytes(ref(admin, 'not-a-known-prefix/thing.png'), png(), imageMetadata);
  });
});

describe('product media', () => {
  it('is readable by anyone', async () => {
    // Catalogue imagery on the storefront critical path, fetched by `next/image`
    // without credentials.
    await assertSucceeds(getBytes(ref(anonymous(), 'products/p1/cover.png')));
  });

  it('accepts a staff upload of an allowed image type', async () => {
    await assertSucceeds(uploadBytes(ref(staff(), 'products/p1/second.png'), png(), imageMetadata));
  });

  it('accepts an owner upload', async () => {
    await assertSucceeds(uploadBytes(ref(owner(), 'products/p1/third.png'), png(), imageMetadata));
  });

  it('denies a customer upload', async () => {
    await assertFails(
      uploadBytes(ref(customer(), 'products/p1/injected.png'), png(), imageMetadata),
    );
  });

  it('denies an anonymous upload', async () => {
    await assertFails(
      uploadBytes(ref(anonymous(), 'products/p1/injected.png'), png(), imageMetadata),
    );
  });

  it('denies a role we never issue', async () => {
    await assertFails(
      uploadBytes(ref(impostor(), 'products/p1/injected.png'), png(), imageMetadata),
    );
  });

  it('denies an SVG upload even from staff', async () => {
    // SVG is a script container and these files render on the admin origin, so it is
    // excluded from the allowlist rather than merely discouraged.
    await assertFails(
      uploadBytes(ref(staff(), 'products/p1/logo.svg'), png(), { contentType: 'image/svg+xml' }),
    );
  });

  it('denies an HTML upload disguised in an image path', async () => {
    await assertFails(
      uploadBytes(ref(staff(), 'products/p1/page.png'), png(), { contentType: 'text/html' }),
    );
  });

  it('denies an upload over the size limit', async () => {
    // The one thing here a client cannot lie about.
    const tooBig = new Uint8Array(5 * 1024 * 1024 + 1);
    await assertFails(uploadBytes(ref(staff(), 'products/p1/huge.png'), tooBig, imageMetadata));
  });

  it('allows staff to replace product photography', async () => {
    // Routine catalogue work; an unremovable wrong image is a support problem.
    await assertSucceeds(uploadBytes(ref(staff(), 'products/p1/cover.png'), png(), imageMetadata));
  });
});

describe('payment proofs', () => {
  const ownProof = `payment-proofs/order-1/${CUSTOMER_UID}/proof.png`;

  it('is readable by the customer who uploaded it', async () => {
    await assertSucceeds(getBytes(ref(customer(), ownProof)));
  });

  it('is readable by staff, who have to verify it', async () => {
    await assertSucceeds(getBytes(ref(staff(), ownProof)));
  });

  it('denies another customer reading it', async () => {
    // A payment proof is often a screenshot of a bank statement.
    await assertFails(getBytes(ref(otherCustomer(), ownProof)));
  });

  it('denies an anonymous read', async () => {
    await assertFails(getBytes(ref(anonymous(), ownProof)));
  });

  it('accepts an upload from the owning customer', async () => {
    await assertSucceeds(
      uploadBytes(
        ref(customer(), `payment-proofs/order-2/${CUSTOMER_UID}/proof.png`),
        png(),
        imageMetadata,
      ),
    );
  });

  it('accepts a PDF, because some banks share receipts that way', async () => {
    await assertSucceeds(
      uploadBytes(ref(customer(), `payment-proofs/order-2/${CUSTOMER_UID}/receipt.pdf`), png(), {
        contentType: 'application/pdf',
      }),
    );
  });

  it('denies uploading into another customer path', async () => {
    // The uid is in the path, so ownership is a path comparison. Metadata on an object
    // the client uploaded would be another client claim.
    await assertFails(
      uploadBytes(
        ref(customer(), `payment-proofs/order-1/${OTHER_CUSTOMER_UID}/forged.png`),
        png(),
        imageMetadata,
      ),
    );
  });

  it('denies staff uploading a proof on a customer behalf', async () => {
    // An admin who could plant the evidence they then verify defeats the point of the
    // evidence.
    await assertFails(
      uploadBytes(
        ref(staff(), `payment-proofs/order-1/${CUSTOMER_UID}/planted.png`),
        png(),
        imageMetadata,
      ),
    );
  });

  it('denies an executable content type', async () => {
    await assertFails(
      uploadBytes(ref(customer(), `payment-proofs/order-2/${CUSTOMER_UID}/x.png`), png(), {
        contentType: 'text/html',
      }),
    );
  });

  it('denies an upload over the size limit', async () => {
    const tooBig = new Uint8Array(5 * 1024 * 1024 + 1);
    await assertFails(
      uploadBytes(
        ref(customer(), `payment-proofs/order-2/${CUSTOMER_UID}/huge.png`),
        tooBig,
        imageMetadata,
      ),
    );
  });
});

describe('store assets', () => {
  it('are readable by anyone', async () => {
    await assertSucceeds(getBytes(ref(anonymous(), 'store-assets/logo-dark.png')));
  });

  it('deny every client write, including an owner', async () => {
    // These come from `stores/<id>/assets/` through the deploy pipeline. A
    // client-writable path here would let a compromised staff account replace the brand.
    await assertFails(
      uploadBytes(ref(owner(), 'store-assets/logo-dark.png'), png(), imageMetadata),
    );
    await assertFails(uploadBytes(ref(staff(), 'store-assets/new-mark.png'), png(), imageMetadata));
  });
});

describe('unmatched paths', () => {
  it('deny reads and writes', async () => {
    await assertFails(getBytes(ref(staff(), 'not-a-known-prefix/thing.png')));
    await assertFails(
      uploadBytes(ref(owner(), 'not-a-known-prefix/other.png'), png(), imageMetadata),
    );
  });
});
