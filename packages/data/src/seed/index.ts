/**
 * The config-driven seed.
 *
 * Split in two on purpose:
 *
 *  - `build.ts` is **pure**. Store config plus a fixed clock in, a list of documents
 *    out, byte-identical every time. All of the interesting logic — derived prices,
 *    rolled-up facet counts, opening-balance ledger entries — is testable here without
 *    a Firestore instance.
 *  - `apply.ts` is the **writer**. It resolves paths, attaches converters, batches, and
 *    refuses to run when running would release stock a live order is holding.
 *
 * The split is also what makes `--dry-run` real rather than a best-effort simulation:
 * the plan printed is the same object the writer consumes.
 */

export { buildSeedPlan } from './build';
export { SeedRefusedError, applySeedPlan, resetSeededCollections } from './apply';
export type { SeedResult } from './apply';
export { assertNoDuplicatePaths, summarisePlan } from './plan';
export type { SeedPlan, SeedWrite, SeedWriteMode } from './plan';
