import type { FirestoreDataConverter, Firestore } from 'firebase-admin/firestore';

import { converters } from '../converters';
import { COLLECTIONS, splitDocumentPath } from '../paths';

import { assertNoDuplicatePaths, summarisePlan } from './plan';
import type { SeedPlan, SeedWrite } from './plan';

/**
 * Performs a seed plan against Firestore.
 *
 * Everything interesting already happened in `buildSeedPlan`. This is the writer, and
 * its job is to be boring: resolve each path to a reference, attach the converter that
 * validates the document, and write. The only judgement it makes is refusing to run
 * when running would be destructive.
 */

export interface SeedResult {
  readonly storeId: string;
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly byCollection: Readonly<Record<string, number>>;
}

export class SeedRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedRefusedError';
  }
}

/**
 * A converter with its document type erased.
 *
 * A seed plan is deliberately heterogeneous — products, variants, inventory and ledger
 * entries in one list — so there is no single type the whole plan satisfies, and the
 * union of twenty-two converters is not assignable to any one of them. This is the one
 * place that heterogeneity meets a generic API, so the erasure happens here, once,
 * rather than at every call site.
 *
 * Nothing is lost by it. Each `write.data` was produced by a typed builder in
 * `build.ts`, and the converter validates the document against its schema before it
 * reaches Firestore — so a mismatch between a plan entry's data and its named converter
 * fails with a `DocumentShapeError` naming the field, which is a better error than the
 * compile-time one would have been anyway.
 */
type ErasedConverter = FirestoreDataConverter<Record<string, unknown>>;

function converterFor(write: SeedWrite): ErasedConverter {
  const registry: Readonly<Record<string, ErasedConverter | undefined>> = converters;
  const converter = registry[write.converter];

  if (converter === undefined) {
    throw new TypeError(
      `The seed plan references converter "${write.converter}", which does not exist. Add it to \`converters\` in @romp/data.`,
    );
  }

  return converter;
}

function referenceFor(db: Firestore, path: string) {
  // Validates the segment count before the SDK does, so the failure names the path
  // rather than surfacing as "Value for argument documentPath must point to a
  // document".
  splitDocumentPath(path);
  return db.doc(path);
}

/**
 * Refuses to overwrite stock that a live order is holding.
 *
 * This is the one guard worth having. The seed writes `reserved: 0` on every inventory
 * document, because a freshly seeded store has no orders. Run against a store that
 * *does* have orders, that write releases every reservation without releasing the
 * orders holding them — so two customers end up buying the same unit and the ledger
 * cannot explain where it went.
 *
 * It checks before writing anything, and it aborts the whole run rather than skipping
 * the affected documents. A half-seeded catalogue where products exist but their
 * inventory does not is worse than no change: the storefront would show items that
 * cannot be added to a cart.
 */
async function assertNoLiveReservations(db: Firestore, plan: SeedPlan): Promise<void> {
  const inventoryWrites = plan.writes.filter((write) => write.converter === 'inventory');
  if (inventoryWrites.length === 0) return;

  const snapshots = await Promise.all(
    inventoryWrites.map(async (write) => ({
      path: write.path,
      snapshot: await referenceFor(db, write.path).get(),
    })),
  );

  const held = snapshots
    .filter(({ snapshot }) => {
      // Read defensively rather than through the converter: a document that fails
      // validation for an unrelated reason must not stop this guard from noticing
      // that stock is reserved.
      const data: Readonly<Record<string, unknown>> = snapshot.data() ?? {};
      const reserved = data.reserved;
      return typeof reserved === 'number' && reserved > 0;
    })
    .map(({ path }) => path);

  if (held.length > 0) {
    throw new SeedRefusedError(
      [
        `Refusing to seed: ${String(held.length)} inventory document${held.length === 1 ? ' has' : 's have'} reserved stock, which means live orders exist.`,
        'Seeding would write `reserved: 0` and release those units without releasing the orders holding them, so two customers could buy the same unit.',
        '',
        ...held.map((path) => `  ${path}`),
        '',
        'Cancel or fulfil the outstanding orders first, or seed a fresh project.',
      ].join('\n'),
    );
  }
}

/**
 * Applies the plan.
 *
 * Batched, because a full catalogue is a few hundred writes and one round trip per
 * document turns a two-second seed into a thirty-second one. Firestore caps a batch at
 * 500 operations, so the chunk size is 400 — under the limit with room for the
 * existence reads that `createIfAbsent` needs.
 *
 * Not transactional, deliberately. A transaction has a 500-document limit too and
 * would have to read every document it writes; the seed is idempotent, so the recovery
 * for a partial failure is to run it again. That is a better property than atomicity
 * here.
 */
export async function applySeedPlan(
  db: Firestore,
  plan: SeedPlan,
  options: { readonly onProgress?: (message: string) => void } = {},
): Promise<SeedResult> {
  assertNoDuplicatePaths(plan);
  await assertNoLiveReservations(db, plan);

  const report = options.onProgress ?? ((): void => undefined);

  // `createIfAbsent` needs to know what exists. Reading only those paths keeps the
  // read count proportional to the handful of singleton documents rather than to the
  // catalogue.
  const conditional = plan.writes.filter((write) => write.mode === 'createIfAbsent');
  const existing = new Set<string>();

  await Promise.all(
    conditional.map(async (write) => {
      const snapshot = await referenceFor(db, write.path).get();
      if (snapshot.exists) existing.add(write.path);
    }),
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;

  const pending = plan.writes.filter((write) => {
    if (write.mode === 'createIfAbsent' && existing.has(write.path)) {
      report(`skipped ${write.label} — already exists and the seed does not own it`);
      skipped += 1;
      return false;
    }
    return true;
  });

  const CHUNK = 400;
  for (let offset = 0; offset < pending.length; offset += CHUNK) {
    const chunk = pending.slice(offset, offset + CHUNK);
    const batch = db.batch();

    for (const write of chunk) {
      const reference = referenceFor(db, write.path).withConverter(converterFor(write));
      // `set` without merge: the file is the truth for everything the seed owns, so a
      // field removed from the catalogue should disappear from the document rather than
      // linger because a merge left it there.
      batch.set(reference, write.data as Record<string, unknown>);

      if (write.mode === 'createIfAbsent') {
        created += 1;
      } else {
        updated += 1;
      }
    }

    await batch.commit();
    report(`wrote ${String(chunk.length)} documents`);
  }

  return {
    storeId: plan.storeId,
    created,
    updated,
    skipped,
    byCollection: summarisePlan(plan),
  };
}

/**
 * Deletes every document the seed owns, for a clean reseed in development.
 *
 * Scoped to the collections the seed writes and nothing else, so it cannot touch
 * orders, users or reviews. It is still destructive, which is why the runner requires
 * `--reset` explicitly and refuses to run it against a project whose ID does not start
 * with `demo-` or end in `-dev` — a flag that wipes a catalogue should not be one
 * keystroke away from doing it in production.
 */
export async function resetSeededCollections(
  db: Firestore,
  options: { readonly onProgress?: (message: string) => void } = {},
): Promise<number> {
  const report = options.onProgress ?? ((): void => undefined);
  const seedOwned = [
    COLLECTIONS.products,
    COLLECTIONS.categories,
    COLLECTIONS.warehouses,
    COLLECTIONS.inventory,
    COLLECTIONS.inventoryLedger,
  ];

  let deleted = 0;

  for (const collection of seedOwned) {
    // `recursiveDelete` removes subcollections too, which matters for
    // `products/{id}/variants` — deleting only the parent would leave orphaned variant
    // documents that no query returns and nothing cleans up.
    await db.recursiveDelete(db.collection(collection));
    report(`cleared ${collection}`);
    deleted += 1;
  }

  return deleted;
}
