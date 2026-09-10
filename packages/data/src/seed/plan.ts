/**
 * A seed as data.
 *
 * The builders in `build.ts` produce a `SeedPlan` — a list of document writes — and
 * `apply.ts` performs them. Splitting it that way is what makes the seed testable
 * without a Firestore instance: the interesting logic is "does a 24/16 stock split
 * produce `onHandTotal: 40` and two ledger entries", and that question should not need
 * an emulator to answer.
 *
 * It also makes the seed inspectable. `pnpm seed --dry-run` prints the plan, so the
 * answer to "what is this about to do to my database" is available before it does it.
 */

/** How an existing document at the same path should be treated. */
export type SeedWriteMode =
  /**
   * Overwrite whatever is there.
   *
   * The default, and what makes the seed re-runnable: catalogue, warehouses and
   * categories are *derived* from files in the repo, so the file is the truth and a
   * re-run reconciles Firestore to it.
   */
  | 'overwrite'
  /**
   * Write only if the document does not exist.
   *
   * For documents the seed *initialises* but does not own. `settings/checkout` is the
   * case: it is seeded from `commerce` in the store config, and then edited in admin
   * without a deploy. Overwriting it would mean every seed run silently reverts a fee
   * change somebody made deliberately.
   */
  | 'createIfAbsent';

/** One document to write. */
export interface SeedWrite<T = unknown> {
  /** Full Firestore document path, from `paths`. */
  readonly path: string;
  /** Which converter validates it — the key into `converters`. */
  readonly converter: string;
  readonly mode: SeedWriteMode;
  /** The decoded document. Instants are `Date`; the converter encodes them. */
  readonly data: T;
  /** Human-readable label for the dry-run output and for failure messages. */
  readonly label: string;
}

/** A complete seed, grouped so the summary can report per collection. */
export interface SeedPlan {
  readonly storeId: string;
  readonly writes: readonly SeedWrite[];
}

/** Counts writes per converter, for the run summary and for the idempotency assertion. */
export function summarisePlan(plan: SeedPlan): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};

  for (const write of plan.writes) {
    counts[write.converter] = (counts[write.converter] ?? 0) + 1;
  }

  return Object.freeze(counts);
}

/**
 * Confirms no two writes target the same path.
 *
 * A duplicate path is not a Firestore error — the second write wins — so a builder bug
 * that derived the same document ID for two products would seed a catalogue quietly
 * missing one of them. Since every seeded ID is derived from a natural key, this is
 * the check that turns "two products share a slug" into a failure with both labels in
 * the message.
 */
export function assertNoDuplicatePaths(plan: SeedPlan): void {
  const seen = new Map<string, string>();
  const collisions: string[] = [];

  for (const write of plan.writes) {
    const previous = seen.get(write.path);
    if (previous === undefined) {
      seen.set(write.path, write.label);
    } else {
      collisions.push(`${write.path} — "${previous}" and "${write.label}"`);
    }
  }

  if (collisions.length > 0) {
    throw new Error(
      `The seed plan writes the same document more than once:\n${collisions
        .map((collision) => `  ${collision}`)
        .join('\n')}`,
    );
  }
}
