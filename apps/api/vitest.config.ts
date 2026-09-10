import { createVitestConfig } from '@romp/config/vitest';

/**
 * Standard tier.
 *
 * The API is orchestration: middleware wiring, route handlers that validate input, call a
 * repository or the Auth SDK, and map the result to a response. The domain rules it
 * enforces live in `@romp/core`, `@romp/contracts` and `@romp/data`, each held to the
 * domain bar already. The bootstrap that only runs against a live runtime or the emulator
 * is coverage-excluded, the same way `@romp/data`'s Firestore bootstrap is.
 */
export default createVitestConfig({
  tier: 'standard',
  coverageExclude: [
    // Admin SDK bootstrap, dependency assembly and the Cloud Functions / dev-server
    // entrypoints only run against a real runtime or the emulator, where the integration
    // suite exercises them. Unit-testing them would test mocks of the SDK.
    'src/firebase.ts',
    'src/bootstrap.ts',
    'src/index.ts',
    'src/dev-server.ts',
    // The Cloud Functions triggers (Firestore + scheduler) and their context binding only
    // run against a real runtime or the emulator, where the integration suite exercises the
    // dispatcher end to end. The dispatch and backlog *logic* is testable and is tested:
    // `dispatcher.ts` and `backlog.ts` are not excluded.
    'src/functions.ts',
    'src/notifications/context.ts',
    // Route handlers orchestrate the Auth Admin SDK and Firestore transactions — creating a
    // user, reserving an identifier, writing a profile, minting a reset link. Their success
    // paths only run correctly against the emulator, where the integration suite drives them
    // end to end (register → sign in → same uid, duplicate → 409, reset link single-use,
    // token revocation). Unit-mocking the SDK here would assert against the mock, not the
    // behaviour. The pre-Firestore decision logic (validation, password policy, rate limit,
    // guards) is covered by the in-process contract tests. Same reasoning as `@romp/infra`.
    'src/routes/**',
  ],
});
