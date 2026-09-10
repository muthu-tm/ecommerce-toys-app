import type { Auth } from 'firebase-admin/auth';

import type { StoreContext } from '@romp/data';
import type { AppLogger } from '@romp/observability';

/**
 * The dependencies the app is built with, injected rather than imported.
 *
 * `buildApp` takes this so a test can supply a silent logger, an emulator-backed `Auth`
 * client and a `StoreContext` over an emulator database, and a fixed config — without the
 * app reaching for module-level singletons that would tie every test to the real SDK
 * bootstrap. Production wires the real clients in the Cloud Functions entrypoint; tests
 * wire emulator clients.
 *
 * Firestore access is carried as a `StoreContext` from `@romp/data`, not a raw
 * `Firestore`, so route handlers hand it straight to a repository. The API never holds the
 * SDK's `Firestore` type directly — that stays behind the data package, which is the one
 * place a query is built.
 */
export interface ApiConfig {
  /** The store slug (`brand.id`), used to derive phone-login aliases. */
  readonly storeId: string;
  /** Brand names, for the password blocklist. */
  readonly brandNames: readonly string[];
  /** Default region for parsing bare phone numbers, from `locale.defaultPhoneRegion`. */
  readonly defaultPhoneRegion: string;
  /**
   * Allowed CORS origins for this deployment — the storefront and admin hosts. Explicit,
   * never a wildcard: a wildcard on a credentialed API is an open door.
   */
  readonly corsOrigins: readonly string[];
  /**
   * Secret used to HMAC-sign the anonymous cart cookie.
   *
   * A guest cart is reached by an opaque cart ID carried in a cookie; signing it stops a
   * client from forging or tampering with the ID to reach a cart that is not theirs. It is a
   * deployment secret, per environment, never committed. A rotation invalidates outstanding
   * guest cookies, which is harmless — the guest simply starts a fresh cart.
   */
  readonly cartCookieSecret: string;
}

/**
 * Invalidates ISR cache tags after a catalogue write.
 *
 * A seam, not a direct call, because the API cannot import `next` — it is a Fastify service,
 * not a Next app. A catalogue publish or edit needs the storefront's cached pages to
 * refresh, so the deployment wires an implementation (a call to the storefront's
 * revalidation endpoint, or Next's `revalidateTag` when co-located) and the API calls it by
 * tag. It is best-effort: revalidation failing must not fail the write, so the caller logs
 * and continues, and the storefront's time-based `revalidate` floor is the backstop.
 */
export type Revalidate = (tags: readonly string[]) => Promise<void>;

export interface ApiDeps {
  readonly logger: AppLogger;
  readonly auth: Auth;
  readonly context: StoreContext;
  readonly config: ApiConfig;
  /**
   * ISR tag revalidation. Optional: absent in tests and in a deployment with no storefront
   * cache to bust, in which case a catalogue write simply does not revalidate.
   */
  readonly revalidate?: Revalidate;
}
