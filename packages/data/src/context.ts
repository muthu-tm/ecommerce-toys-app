import type { Firestore } from 'firebase-admin/firestore';

import { NotFoundError } from '@romp/observability';

import type { Clock } from './clock';
import { systemClock } from './clock';

/**
 * The two seams every repository method depends on: which store, and who is asking.
 *
 * Both are **parameters**, never ambient state. That is the single most consequential
 * decision in this file, and it follows from one fact stated three times in the docs
 * and worth stating again: **the Admin SDK bypasses security rules entirely.**
 * `infra/firestore.rules` does not apply to anything in this package. Ownership
 * filtering here is not a second line of defence — it is the only line.
 *
 * Ambient identity is how that goes wrong. Read the caller from a module-level
 * variable, an async-local store, or a request-scoped singleton, and a repository
 * method compiles and runs whether or not anyone remembered to set it. A background
 * job, a cache warmer or a test then reads with whatever identity was left behind. As
 * a required parameter, "I forgot who is asking" is a compile error.
 */

/**
 * Roles, from Firebase Auth **custom claims**.
 *
 * Never derived from a Firestore document. A role stored where a client can write is a
 * role a client can grant itself, and one stored where a client can read still costs a
 * document read on every check (`SECURITY.md` § 2).
 */
export type Role = 'staff' | 'owner';

/**
 * Who is asking.
 *
 * A discriminated union rather than `{ uid?: string; role?: string }`, because the
 * optional-fields version admits `{ uid: undefined, role: 'owner' }` — an anonymous
 * owner — and every consumer then has to decide what that means. Here it is
 * unrepresentable.
 */
export type Caller =
  /** No credentials. The storefront before sign-in. Can read the public catalogue only. */
  | { readonly kind: 'anonymous' }
  /** A signed-in customer with no role claim. */
  | { readonly kind: 'customer'; readonly uid: string }
  /** A signed-in operator. `role` decides what beyond backoffice reads they may do. */
  | { readonly kind: 'operator'; readonly uid: string; readonly role: Role }
  /**
   * Trusted server-side work with no human behind it: the reservation sweeper, the
   * notification dispatcher, the analytics rollup, the seed.
   *
   * Deliberately its own kind rather than an operator with a synthetic uid. An audit
   * entry must never be ambiguous about whether a person was involved, and a system
   * caller that looked like an operator would appear in the audit trail as one.
   */
  | { readonly kind: 'system'; readonly reason: string };

export const ANONYMOUS: Caller = Object.freeze({ kind: 'anonymous' });

export function asCustomer(uid: string): Caller {
  return { kind: 'customer', uid };
}

export function asOperator(uid: string, role: Role): Caller {
  return { kind: 'operator', uid, role };
}

/**
 * A trusted caller with no human behind it.
 *
 * `reason` is required and ends up in the audit trail, so "why did the system do this"
 * is answerable. A system caller with no stated reason is an unexplained write.
 */
export function asSystem(reason: string): Caller {
  return { kind: 'system', reason };
}

/** The uid to attribute an action to, or `'system'`. Matches `ActorId` in the contracts. */
export function actorIdOf(caller: Caller): string {
  return caller.kind === 'customer' || caller.kind === 'operator' ? caller.uid : 'system';
}

/**
 * Whether the caller may see backoffice data.
 *
 * `system` counts: the dispatcher and the sweeper read across the whole store by
 * definition. What it must not do is *stand in for* a human in an audit record, which
 * is why `actorIdOf` keeps them distinct.
 */
export function isStaff(caller: Caller): boolean {
  return caller.kind === 'system' || caller.kind === 'operator';
}

/** Whether the caller may issue refunds and change settings — the money-moving actions. */
export function isOwner(caller: Caller): boolean {
  return caller.kind === 'system' || (caller.kind === 'operator' && caller.role === 'owner');
}

/** The caller's own uid, or null for anonymous and system callers. */
export function uidOf(caller: Caller): string | null {
  return caller.kind === 'customer' || caller.kind === 'operator' ? caller.uid : null;
}

/**
 * Whether this caller may read a document owned by `ownerUid`.
 *
 * Staff may read anyone's. A customer may read their own. Anonymous callers may read
 * nobody's — including documents with no owner, because a null owner reaching this
 * function means a document that should have had one.
 */
export function ownsOrIsStaff(caller: Caller, ownerUid: string | null): boolean {
  if (isStaff(caller)) return true;
  if (ownerUid === null) return false;
  return uidOf(caller) === ownerUid;
}

/**
 * Returns the resource if the caller may see it, and **404 if not**.
 *
 * Not 403. A 403 confirms the resource exists, which is itself a disclosure about
 * another customer's data — an attacker enumerating order IDs learns which ones are
 * real (`SECURITY.md` § 2). So "does not exist" and "not yours" are the same outcome,
 * and `NotFoundError.forHiddenResource` records which of the two it actually was in
 * the log context, where only we can see it.
 *
 * Takes the resource *and* its owner so the check cannot be separated from the read it
 * guards. A `canRead(caller, uid)` boolean returning true is easy to call and forget
 * to branch on; this function's return value is the only way to get the document.
 */
export function requireOwnership<T>(
  caller: Caller,
  resource: T | null,
  ownerUidOf: (resource: T) => string | null,
  descriptor: { readonly resource: string; readonly id: string },
): T {
  if (resource === null) {
    throw new NotFoundError({ context: { ...descriptor, reason: 'absent' } });
  }

  if (!ownsOrIsStaff(caller, ownerUidOf(resource))) {
    throw NotFoundError.forHiddenResource(descriptor.resource, { id: descriptor.id });
  }

  return resource;
}

/**
 * Throws unless the caller may see backoffice data.
 *
 * For collection reads with no per-document owner to check — `inventory`, `warehouses`,
 * the verification queue. A 404 again rather than a 403, for the same reason.
 */
export function requireStaff(caller: Caller, descriptor: { readonly resource: string }): void {
  if (!isStaff(caller)) {
    throw NotFoundError.forHiddenResource(descriptor.resource, { requiredRole: 'staff' });
  }
}

/** Throws unless the caller may perform an owner-only action. */
export function requireOwnerRole(caller: Caller, descriptor: { readonly resource: string }): void {
  if (!isOwner(caller)) {
    throw NotFoundError.forHiddenResource(descriptor.resource, { requiredRole: 'owner' });
  }
}

/**
 * Everything a repository needs that is not an argument to the query itself.
 *
 * `storeId` is the multi-tenant seam (ADR-0005). v1.0 is single-tenant — one Firebase
 * project per store — so nothing in this package branches on it today, and it is
 * carried on every call anyway. The reason is that adding a tenant discriminator later
 * means touching every method signature *and* every call site, and the first missed
 * one is a cross-tenant read. Threading it now costs a field; adding it later costs an
 * audit. It is also the value that makes a log line answerable about which store a
 * request was for, which matters as soon as one process serves two.
 *
 * `clock` is here rather than read inline so a test can assert an exact timestamp and
 * the seed can be deterministic (see `clock.ts`).
 */
export interface StoreContext {
  readonly storeId: string;
  readonly db: Firestore;
  readonly clock: Clock;
}

export function createStoreContext(options: {
  readonly storeId: string;
  readonly db: Firestore;
  readonly clock?: Clock;
}): StoreContext {
  if (options.storeId === '') {
    // An empty store ID would make every log line and every future tenant filter
    // silently match nothing.
    throw new TypeError('A StoreContext needs a non-empty storeId.');
  }

  return {
    storeId: options.storeId,
    db: options.db,
    clock: options.clock ?? systemClock,
  };
}
