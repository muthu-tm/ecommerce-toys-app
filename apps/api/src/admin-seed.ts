import { randomBytes } from 'node:crypto';

import type { Auth } from 'firebase-admin/auth';

import { classifyIdentifier, normalizeEmail, normalizePhone, toAuthEmail } from '@romp/core';
import type { AppLogger } from '@romp/observability';

/**
 * Seeds administrators from a config list — the reusable core behind `pnpm seed:admins`.
 *
 * Kept separate from the CLI so it is unit-testable with a fake `Auth`: the CLI wires the
 * real Admin SDK and prints the results, this decides what to do. It is **idempotent** —
 * re-running updates an existing admin's claim and display name rather than failing or
 * duplicating, which is the intended way to rotate a role or fix a name.
 *
 * The `role` custom claim is what the API's role guard reads from the verified token. A
 * newly granted claim is only visible after the session refreshes its token (sign out and
 * in, or a force-refresh), because claims propagate on refresh — documented so it is not
 * mistaken for the seed not working.
 */

export interface AdminSeedEntry {
  readonly identifier: string;
  readonly displayName: string;
  readonly role: 'owner' | 'staff';
}

export interface AdminSeedConfig {
  /** The store slug, for deriving a phone admin's login alias. */
  readonly storeId: string;
  /** Default region for parsing a bare phone number. */
  readonly defaultPhoneRegion: string;
}

export interface SeededAdmin {
  readonly identifier: string;
  readonly loginEmail: string;
  readonly uid: string;
  readonly role: 'owner' | 'staff';
  /** Present only when the account was newly created — the one-time initial password. */
  readonly initialPassword?: string;
  readonly created: boolean;
}

/** Generates a strong random initial password, printed once for the operator to change. */
export function generateInitialPassword(): string {
  // 24 url-safe bytes ≈ 32 chars: well past the length floor and unguessable. It is shown
  // once and must be rotated on first sign-in, so memorability does not matter.
  return randomBytes(24).toString('base64url');
}

/**
 * Seeds one admin: mint or update the Auth user, set the `role` claim.
 *
 * Looks the account up by its derived login email. If absent, creates it with a generated
 * password (returned once). If present, leaves the password alone and only reconciles the
 * display name and claim — so re-running never resets a working admin's password.
 */
export async function seedAdmin(
  auth: Auth,
  config: AdminSeedConfig,
  entry: AdminSeedEntry,
  makePassword: () => string = generateInitialPassword,
): Promise<SeededAdmin> {
  const loginEmail = deriveLoginEmail(entry.identifier, config);

  const existing = await auth.getUserByEmail(loginEmail).catch(() => null);

  if (existing === null) {
    const initialPassword = makePassword();
    const created = await auth.createUser({
      email: loginEmail,
      password: initialPassword,
      displayName: entry.displayName,
      ...(classifyIdentifier(entry.identifier) === 'phone'
        ? { phoneNumber: normalizePhone(entry.identifier, config.defaultPhoneRegion) }
        : {}),
    });
    // `mustRotate` rides in the claims so the admin app can require a change on first
    // sign-in; the `role` claim is what actually authorises.
    await auth.setCustomUserClaims(created.uid, { role: entry.role, mustRotate: true });
    return {
      identifier: entry.identifier,
      loginEmail,
      uid: created.uid,
      role: entry.role,
      initialPassword,
      created: true,
    };
  }

  // Reconcile an existing admin without touching their password. Setting the claim again is
  // how a role change is applied on a re-run.
  await auth.setCustomUserClaims(existing.uid, {
    ...existing.customClaims,
    role: entry.role,
  });
  if (existing.displayName !== entry.displayName) {
    await auth.updateUser(existing.uid, { displayName: entry.displayName });
  }

  return {
    identifier: entry.identifier,
    loginEmail,
    uid: existing.uid,
    role: entry.role,
    created: false,
  };
}

/** Seeds a whole list, sequentially so log output is ordered and Auth is not hammered. */
export async function seedAdmins(
  auth: Auth,
  config: AdminSeedConfig,
  entries: readonly AdminSeedEntry[],
  logger: AppLogger,
  makePassword: () => string = generateInitialPassword,
): Promise<readonly SeededAdmin[]> {
  const results: SeededAdmin[] = [];
  for (const entry of entries) {
    const result = await seedAdmin(auth, config, entry, makePassword);
    logger.info(
      { event: 'admin.seeded', uid: result.uid, role: result.role, created: result.created },
      'admin.seeded',
    );
    results.push(result);
  }
  return results;
}

/** Derives the Auth login email from a raw identifier — real email, or the phone alias. */
function deriveLoginEmail(identifier: string, config: AdminSeedConfig): string {
  if (classifyIdentifier(identifier) === 'email') {
    return normalizeEmail(identifier);
  }
  return toAuthEmail(normalizePhone(identifier, config.defaultPhoneRegion), config.storeId);
}
