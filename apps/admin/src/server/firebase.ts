import 'server-only';

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

/**
 * The Admin SDK Firestore handle for the backoffice's server rendering.
 *
 * `import 'server-only'` is the first line and load-bearing: it turns an accidental client
 * import into a build error. The backoffice reads the catalogue server-side to render its
 * lists and edit forms; writes go through the API (which owns the mutations and the audit).
 * Because the Admin SDK bypasses security rules, every read here passes a caller and the
 * repository layer filters — and the backoffice reads as a staff operator, so it sees draft
 * and archived products the public storefront cannot.
 *
 * Credentialing mirrors the storefront: the emulator when its host var is set, Application
 * Default Credentials in a deployed runtime, or a service-account JSON from an env var for a
 * local process pointed at a real project. There is no service-account file in the repo.
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
        privateKey: parsed.private_key.replace(/\\n/gu, '\n'),
      }),
    });
  }
  return initializeApp({ projectId });
}

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
 * False during `next build`, where there is no project — so a page prerenders an empty shell
 * and fills it on the first request, exactly as the storefront does.
 */
export function catalogueAvailable(): boolean {
  return (
    process.env.GOOGLE_CLOUD_PROJECT !== undefined ||
    process.env.GCLOUD_PROJECT !== undefined ||
    process.env.FIREBASE_PROJECT_ID !== undefined
  );
}

let firestore: Firestore | undefined;

/** The shared Firestore instance, memoised per instance so the connection pool is reused. */
export function db(): Firestore {
  firestore ??= getFirestore(credentialedApp());
  return firestore;
}

/** The store this deployment serves, from build-time config. Never guessed. */
export function storeId(): string {
  const id = process.env.STORE_ID ?? process.env.NEXT_PUBLIC_STORE_ID;
  if (id === undefined || id === '') {
    throw new Error('STORE_ID is not set. Run `pnpm store:tokens` and build with STORE_ID set.');
  }
  return id;
}
