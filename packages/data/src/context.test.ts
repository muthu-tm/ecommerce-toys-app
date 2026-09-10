import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { NotFoundError } from '@romp/observability';

import { fixedClock, systemClock } from './clock';
import {
  ANONYMOUS,
  actorIdOf,
  asCustomer,
  asOperator,
  asSystem,
  createStoreContext,
  isOwner,
  isStaff,
  ownsOrIsStaff,
  requireOwnerRole,
  requireOwnership,
  requireStaff,
  uidOf,
} from './context';

/**
 * The ownership seam.
 *
 * Worth more scrutiny than any other file in this package, because
 * `infra/firestore.rules` does not apply to anything here — the Admin SDK bypasses it.
 * Every assertion below is the only thing standing between a wrong uid and another
 * customer's data.
 *
 * The recurring assertion is that refusal is **404, not 403**. A 403 confirms the
 * resource exists, which is a disclosure about another customer (`SECURITY.md` § 2).
 */

const CUSTOMER = asCustomer('customer-1');
const OTHER_CUSTOMER = asCustomer('customer-2');
const STAFF = asOperator('staff-1', 'staff');
const OWNER = asOperator('owner-1', 'owner');
const SYSTEM = asSystem('reservation sweeper');

describe('caller shapes', () => {
  it('makes an anonymous owner unrepresentable', () => {
    // The point of the discriminated union: `{ uid: undefined, role: 'owner' }` cannot be
    // constructed, so no consumer has to decide what it would mean.
    expect(ANONYMOUS.kind).toBe('anonymous');
    expect(uidOf(ANONYMOUS)).toBeNull();
  });

  it('exposes a uid for humans and none for anonymous or system callers', () => {
    expect(uidOf(CUSTOMER)).toBe('customer-1');
    expect(uidOf(STAFF)).toBe('staff-1');
    expect(uidOf(ANONYMOUS)).toBeNull();
    expect(uidOf(SYSTEM)).toBeNull();
  });

  it('attributes system work to `system`, never to a person', () => {
    // An audit entry must never be ambiguous about whether a human was involved.
    expect(actorIdOf(SYSTEM)).toBe('system');
    expect(actorIdOf(ANONYMOUS)).toBe('system');
    expect(actorIdOf(CUSTOMER)).toBe('customer-1');
    expect(actorIdOf(OWNER)).toBe('owner-1');
  });

  it('requires a reason from a system caller', () => {
    // A system caller with no stated reason is an unexplained write.
    expect(asSystem('notification dispatcher')).toMatchObject({
      kind: 'system',
      reason: 'notification dispatcher',
    });
  });
});

describe('isStaff', () => {
  it('admits operators of both roles and the system', () => {
    expect(isStaff(STAFF)).toBe(true);
    expect(isStaff(OWNER)).toBe(true);
    // The dispatcher and the sweeper read across the whole store by definition.
    expect(isStaff(SYSTEM)).toBe(true);
  });

  it('refuses customers and anonymous callers', () => {
    expect(isStaff(CUSTOMER)).toBe(false);
    expect(isStaff(ANONYMOUS)).toBe(false);
  });
});

describe('isOwner', () => {
  it('admits only the owner role and the system', () => {
    expect(isOwner(OWNER)).toBe(true);
    expect(isOwner(SYSTEM)).toBe(true);
  });

  it('refuses a staff operator', () => {
    // Refunds move money outward. Staff verify payments; owners send money back.
    expect(isOwner(STAFF)).toBe(false);
  });

  it('refuses customers and anonymous callers', () => {
    expect(isOwner(CUSTOMER)).toBe(false);
    expect(isOwner(ANONYMOUS)).toBe(false);
  });
});

describe('ownsOrIsStaff', () => {
  it('lets a customer read their own', () => {
    expect(ownsOrIsStaff(CUSTOMER, 'customer-1')).toBe(true);
  });

  it('refuses a customer reading someone else', () => {
    expect(ownsOrIsStaff(CUSTOMER, 'customer-2')).toBe(false);
  });

  it('lets staff read anyone', () => {
    expect(ownsOrIsStaff(STAFF, 'customer-1')).toBe(true);
    expect(ownsOrIsStaff(STAFF, null)).toBe(true);
  });

  it('refuses an anonymous caller even for an unowned document', () => {
    // A null owner reaching this function means a document that should have had one.
    expect(ownsOrIsStaff(ANONYMOUS, null)).toBe(false);
    expect(ownsOrIsStaff(ANONYMOUS, 'customer-1')).toBe(false);
  });

  it('refuses a customer for an unowned document', () => {
    // An anonymous cart, for instance. Reached by cookie through the API, never by uid.
    expect(ownsOrIsStaff(CUSTOMER, null)).toBe(false);
  });
});

describe('requireOwnership', () => {
  const order = { userId: 'customer-1', humanId: 'RMP-1001' };
  const ownerOf = (candidate: typeof order) => candidate.userId;
  const descriptor = { resource: 'order', id: 'order-1' };

  it('returns the resource to its owner', () => {
    expect(requireOwnership(CUSTOMER, order, ownerOf, descriptor)).toBe(order);
  });

  it('returns the resource to staff', () => {
    expect(requireOwnership(STAFF, order, ownerOf, descriptor)).toBe(order);
  });

  it('throws not-found for a foreign caller, not forbidden', () => {
    // The assertion this whole file exists for.
    try {
      requireOwnership(OTHER_CUSTOMER, order, ownerOf, descriptor);
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      if (!(error instanceof NotFoundError)) return;
      expect(error.code).toBe('NOT_FOUND');
    }
  });

  it('gives the same error for absent and for not-yours', () => {
    // Indistinguishable from outside is the requirement. An attacker enumerating order
    // IDs must not learn which ones are real.
    const absent = captureError(() => requireOwnership(CUSTOMER, null, ownerOf, descriptor));
    const foreign = captureError(() =>
      requireOwnership(OTHER_CUSTOMER, order, ownerOf, descriptor),
    );

    expect(absent?.code).toBe(foreign?.code);
    expect(absent?.message).toBe(foreign?.message);
  });

  it('records which of the two it actually was, in the log context', () => {
    // Where only we can see it.
    const absent = captureError(() => requireOwnership(CUSTOMER, null, ownerOf, descriptor));
    const foreign = captureError(() =>
      requireOwnership(OTHER_CUSTOMER, order, ownerOf, descriptor),
    );

    expect(absent?.context).toMatchObject({ reason: 'absent' });
    expect(foreign?.context).toMatchObject({ reason: 'not_owned_by_caller' });
  });

  it('refuses an anonymous caller', () => {
    expect(() => requireOwnership(ANONYMOUS, order, ownerOf, descriptor)).toThrow(NotFoundError);
  });

  it('lets the system through, for the dispatcher and the sweeper', () => {
    expect(requireOwnership(SYSTEM, order, ownerOf, descriptor)).toBe(order);
  });
});

describe('requireStaff', () => {
  it('passes for operators and the system', () => {
    expect(() => {
      requireStaff(STAFF, { resource: 'inventory' });
    }).not.toThrow();
    expect(() => {
      requireStaff(OWNER, { resource: 'inventory' });
    }).not.toThrow();
    expect(() => {
      requireStaff(SYSTEM, { resource: 'inventory' });
    }).not.toThrow();
  });

  it('throws not-found for a customer', () => {
    const error = captureError(() => {
      requireStaff(CUSTOMER, { resource: 'inventory' });
    });

    expect(error?.code).toBe('NOT_FOUND');
    expect(error?.context).toMatchObject({ requiredRole: 'staff' });
  });

  it('throws not-found for an anonymous caller', () => {
    expect(() => {
      requireStaff(ANONYMOUS, { resource: 'inventory' });
    }).toThrow(NotFoundError);
  });
});

describe('requireOwnerRole', () => {
  it('passes for an owner and the system', () => {
    expect(() => {
      requireOwnerRole(OWNER, { resource: 'refunds' });
    }).not.toThrow();
    expect(() => {
      requireOwnerRole(SYSTEM, { resource: 'refunds' });
    }).not.toThrow();
  });

  it('throws for a staff operator', () => {
    const error = captureError(() => {
      requireOwnerRole(STAFF, { resource: 'refunds' });
    });

    expect(error?.code).toBe('NOT_FOUND');
    expect(error?.context).toMatchObject({ requiredRole: 'owner' });
  });

  it('throws for a customer', () => {
    expect(() => {
      requireOwnerRole(CUSTOMER, { resource: 'refunds' });
    }).toThrow(NotFoundError);
  });
});

describe('createStoreContext', () => {
  const db = {} as Firestore;

  it('carries the store ID', () => {
    // Nothing branches on it in v1.0. It is threaded now because adding a tenant
    // discriminator later means touching every signature and every call site, and the
    // first missed one is a cross-tenant read (ADR-0005).
    expect(createStoreContext({ storeId: 'romp', db }).storeId).toBe('romp');
  });

  it('defaults to the system clock', () => {
    expect(createStoreContext({ storeId: 'romp', db }).clock).toBe(systemClock);
  });

  it('accepts an injected clock, so a test can assert an exact timestamp', () => {
    const clock = fixedClock(new Date('2026-03-01T09:30:00.000Z'));

    expect(createStoreContext({ storeId: 'romp', db, clock }).clock.now().toISOString()).toBe(
      '2026-03-01T09:30:00.000Z',
    );
  });

  it('refuses an empty store ID', () => {
    // It would make every log line and every future tenant filter silently match nothing.
    expect(() => createStoreContext({ storeId: '', db })).toThrow(TypeError);
  });
});

/** Runs a thunk and returns the `NotFoundError` it threw, for asserting on its shape. */
function captureError(thunk: () => unknown): NotFoundError | undefined {
  try {
    thunk();
    return undefined;
  } catch (error) {
    return error instanceof NotFoundError ? error : undefined;
  }
}
