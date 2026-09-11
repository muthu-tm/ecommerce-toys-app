import { type FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  type FirebaseStorage,
  connectStorageEmulator,
  getStorage,
  ref,
  uploadBytes,
} from 'firebase/storage';

import { connectStorageToEmulator, emulatorConfig } from './firebase-emulator';

/**
 * The client Firebase SDK for the backoffice browser.
 *
 * Separate from the server data layer (Admin SDK, `src/server/*`) in every way: it runs in
 * the browser, writes under security rules as the signed-in operator, and holds only the
 * public web config. The backoffice uses it for one thing the server cannot do on the
 * operator's behalf — uploading a product image straight to Storage, where the rules gate
 * the write on the operator's token, the size and the declared type.
 *
 * Config is `NEXT_PUBLIC_*` because a Firebase web config is not a secret; rules protect the
 * data. Absent config leaves the client null and the media controls disabled, the honest
 * state before the project is wired. Coverage-excluded: browser-SDK glue.
 */

interface WebConfig {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly appId: string;
  readonly storageBucket: string;
}

/**
 * A synthetic config for emulator mode. The emulator validates none of these; the project ID
 * must match the emulator's project so the operator and the seeded data share it. The
 * orchestrator sets `NEXT_PUBLIC_FIREBASE_PROJECT_ID`; the fallback derives a `demo-<store>`
 * project from the store id so nothing brand-specific is hardcoded here.
 */
function emulatorWebConfig(): WebConfig {
  const storeId = process.env.NEXT_PUBLIC_STORE_ID ?? 'store';
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? `demo-${storeId}`;
  return {
    apiKey: 'emulator-api-key',
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    appId: 'emulator-app-id',
    storageBucket: `${projectId}.appspot.com`,
  };
}

function webConfig(): WebConfig | null {
  // Emulator mode does not need a real web config — the emulator ignores it.
  if (emulatorConfig().enabled) return emulatorWebConfig();

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (
    apiKey === undefined ||
    projectId === undefined ||
    appId === undefined ||
    authDomain === undefined ||
    storageBucket === undefined
  ) {
    return null;
  }
  return { apiKey, authDomain, projectId, appId, storageBucket };
}

let app: FirebaseApp | undefined;

export function clientApp(): FirebaseApp | null {
  if (app !== undefined) return app;
  const config = webConfig();
  if (config === null) return null;
  app = getApps()[0] ?? initializeApp(config);
  return app;
}

let storage: FirebaseStorage | undefined;

function storageClient(): FirebaseStorage | null {
  if (storage !== undefined) return storage;
  const configured = clientApp();
  if (configured === null) return null;
  storage = getStorage(configured);
  // In emulator mode, point Storage at the local emulator — once, before any upload. A no-op
  // when the flag is off, so production is untouched.
  connectStorageToEmulator(storage, (instance, host, port) => {
    connectStorageEmulator(instance as FirebaseStorage, host, port);
  });
  return storage;
}

/**
 * Uploads a file to the given Storage object path (allocated by the API's media route).
 *
 * The rules enforce that only a staff operator may write under `products/`, within the size
 * limit and with an allowed declared type — so this is a direct client upload, not a proxy
 * through the API. The object-finalize Function then re-derives the type authoritatively and
 * quarantines a mismatch. Returns false when the SDK is not configured, so the caller can
 * surface "media host not configured" rather than throwing.
 */
export async function uploadToPath(
  objectPath: string,
  file: File,
  contentType: string,
): Promise<boolean> {
  const client = storageClient();
  if (client === null) return false;
  await uploadBytes(ref(client, objectPath), file, { contentType });
  return true;
}
