import 'server-only';

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

/**
 * The Admin SDK Firestore handle for server rendering.
 *
 * `import 'server-only'` is the first line and it is load-bearing: it turns any accidental
 * import from a client component into a build error rather than a runtime one. The Admin
 * SDK holds credentials that can read and write every document in the project bypassing
 * security rules — a bundle that shipped it to the browser would be the worst leak the
 * platform could have, so the guard is a compile-time wall, not a convention.
 *
 * This is the storefront's *read* path (ADR-0001): server components read the catalogue
 * through the Admin SDK for SEO-critical pages, while all writes go through Cloud
 * Functions. Because the Admin SDK bypasses rules, every read here is ownership-filtered
 * by the repository layer — and the storefront's public reads pass the anonymous caller,
 * so the status filter is the control.
 *
 * The import restriction in `createAppConfig` forbids `firebase-admin` everywhere in the
 * app *except* this file, which is allow-listed in `eslint.config.mjs`. That is the point
 * of the allow-list: there is exactly one sanctioned place to hold the SDK, and it is
 * marked server-only.
 */

/**
 * How the Admin SDK is credentialed, chosen by environment.
 *
 * Three cases, in order:
 *
 *  - **Emulator.** `FIRESTORE_EMULATOR_HOST` is set, so the SDK talks to a local emulator
 *    and ignores credentials entirely. A `demo-` project ID keeps it fully offline. This
 *    is what a page test and `pnpm dev` against the emulator use.
 *  - **App Hosting / Cloud Functions.** No key. The runtime provides Application Default
 *    Credentials via the attached service account, which is why there is no service
 *    account JSON anywhere in the repo (`SECURITY.md` § secrets).
 *  - **A key in the environment.** Only for a local process pointed at a real project,
 *    supplied out of band. Parsed from a single env var rather than a file path, so a
 *    key never lands on disk.
 */
function credentialedApp(): App {
  const existing = getApps()[0];
  if (existing !== undefined) return existing;

  const projectId = resolveProjectId();

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccountJson !== undefined && serviceAccountJson !== '') {
    const parsed = JSON.parse(serviceAccountJson) as {
      project_id: string;
      client_email: string;
      private_key: string;
    };
    return initializeApp({
      projectId,
      credential: cert({
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        // A key pasted into an env var has its newlines escaped; the SDK needs them real.
        privateKey: parsed.private_key.replace(/\\n/gu, '\n'),
      }),
    });
  }

  // ADC in a deployed runtime, or the emulator when its host var is set.
  return initializeApp({ projectId });
}

/**
 * Resolves the project ID, with no default.
 *
 * A storefront that guessed a project is a storefront that eventually renders one store's
 * catalogue under another store's brand. The emulator's own `GCLOUD_PROJECT` (set to
 * `demo-romp` by `firebase emulators:exec`) satisfies this in tests and local dev.
 */
function resolveProjectId(): string {
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCLOUD_PROJECT ??
    process.env.FIREBASE_PROJECT_ID;

  if (projectId === undefined || projectId === '') {
    throw new Error(
      'No Firebase project resolved. Set GOOGLE_CLOUD_PROJECT (App Hosting sets it automatically; the emulator sets GCLOUD_PROJECT).',
    );
  }

  return projectId;
}

/**
 * Whether a Firestore connection can be made at all.
 *
 * True at request time in every real environment. **False during `next build`**, where
 * there is no project and no credentials — the build runs on a CI machine or a developer's
 * laptop, not inside App Hosting. The read layer checks this so a page can prerender an
 * empty shell at build and fill it from live data on the first request, rather than the
 * build failing or baking an empty catalogue into a page marked "static". ISR then
 * revalidates the shell into a real page.
 *
 * The distinction it draws is exactly "is a datastore reachable", not "is this
 * production" — the emulator sets `GCLOUD_PROJECT`, so a build or test run against the
 * emulator is available and renders real data.
 */
export function catalogueAvailable(): boolean {
  return (
    process.env.GOOGLE_CLOUD_PROJECT !== undefined ||
    process.env.GCLOUD_PROJECT !== undefined ||
    process.env.FIREBASE_PROJECT_ID !== undefined
  );
}

let firestore: Firestore | undefined;

/**
 * The shared Firestore instance.
 *
 * Memoised at the module level rather than created per request, because the Admin SDK
 * maintains a connection pool and re-initialising it per render would exhaust the pool
 * under load. Next reuses the module across requests in a warm instance, so this is
 * initialised once per instance and shared.
 */
export function db(): Firestore {
  firestore ??= getFirestore(credentialedApp());
  return firestore;
}

/** The store this deployment serves, from build-time config. Never guessed. */
export function storeId(): string {
  const id = process.env.STORE_ID ?? process.env.NEXT_PUBLIC_STORE_ID;
  if (id === undefined || id === '') {
    // The token generator writes STORE_ID into the build, so an unset value means the
    // build skipped `store:tokens` — the same failure the lint config guards against.
    throw new Error('STORE_ID is not set. Run `pnpm store:tokens` and build with STORE_ID set.');
  }
  return id;
}
