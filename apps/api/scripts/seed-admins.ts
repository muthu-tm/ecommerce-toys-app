#!/usr/bin/env node
/**
 * `pnpm seed:admins` — mints or updates the store's administrators.
 *
 * Admins are seeded, never self-registered (`IDENTITY.md`). This reads the admin list
 * (`stores/<id>/admins.config.ts` if present, else `infra/admins.config.ts`), and for each:
 * derives the login email, creates the Auth user with a generated one-time password (or
 * reconciles an existing one without touching its password), and sets the `role` custom
 * claim.
 *
 * Usage:
 *   pnpm seed:admins                 # STORE_ID or default store, against the configured project
 *   STORE_ID=toybox pnpm seed:admins
 *
 * Against the emulator, export `FIREBASE_AUTH_EMULATOR_HOST` first (or run under
 * `firebase emulators:exec`). Against a real project, authenticate with ADC first.
 *
 * Newly generated passwords are printed once, here, and nowhere else — the platform sends
 * no email (ADR-0007), so the operator relays them out of band and the admin rotates on
 * first sign-in.
 */
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

import { createLogger } from '@romp/observability';
import storeConfig from '@romp/store-config/generated/store-config.json';

import { admins as defaultAdmins } from '../../../infra/admins.config';
import { seedAdmins } from '../src/admin-seed';
import type { AdminSeedEntry } from '../src/admin-seed';

async function loadAdmins(storeId: string): Promise<readonly AdminSeedEntry[]> {
  // A per-store override takes precedence, so a second store ships its own operators.
  const overridePath = new URL(`../../../stores/${storeId}/admins.config.ts`, import.meta.url);
  if (existsSync(overridePath)) {
    const imported = (await import(pathToFileURL(overridePath.pathname).href)) as {
      admins: readonly AdminSeedEntry[];
    };
    return imported.admins;
  }
  return defaultAdmins;
}

async function main(): Promise<void> {
  const logger = createLogger({ name: 'seed-admins', pretty: true });
  const storeId = storeConfig.brand.id;
  const defaultPhoneRegion = storeConfig.locale.defaultPhoneRegion;

  initializeApp();
  const auth = getAuth();

  const entries = await loadAdmins(storeId);
  const results = await seedAdmins(auth, { storeId, defaultPhoneRegion }, entries, logger);

  // Print the one-time passwords for newly created accounts, plainly, so the operator can
  // relay them. Existing admins print no password because theirs was not touched.
  const created = results.filter((result) => result.created);
  if (created.length > 0) {
    logger.warn(
      { count: created.length },
      'Initial passwords below are shown ONCE. Relay them securely and rotate on first sign-in.',
    );
    for (const admin of created) {
      console.log(`  ${admin.loginEmail}  (${admin.role})  ${admin.initialPassword ?? ''}`);
    }
  }

  logger.info(
    { total: results.length, created: created.length },
    'Admin seeding complete. Claims are visible after each session refreshes its token.',
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
