#!/usr/bin/env node
/**
 * `pnpm reconcile:categories` — reconciles `categories.productCount` against the products.
 *
 * `productCount` is a denormalised facet count maintained by increments (the product-write
 * Function), and any counter maintained by increments can drift: a Function retry that
 * double-applies, a manual Firestore edit, a backfill. This recomputes each category's count
 * from the `active` products actually filed under it and its children, reports any divergence,
 * and — with `--fix` — writes the corrected number.
 *
 * Read-only without `--fix`, so it is safe to run against production while diagnosing. It walks
 * every category by default, or a single one with `--slug`.
 *
 * Usage:
 *   pnpm reconcile:categories --project romp-dev              # report every category
 *   pnpm reconcile:categories --project romp-dev --slug wooden
 *   pnpm reconcile:categories --project romp-dev --fix        # correct any drift
 *
 * Against the emulators, start them and export the host variables first.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { systemClock } from '../src/clock';
import { asSystem, createStoreContext } from '../src/context';
import { listCategories } from '../src/repositories/catalogue';
import { reconcileCategoryCount } from '../src/repositories/category-write';

interface Options {
  readonly projectId: string | undefined;
  readonly storeId: string;
  readonly slug: string | undefined;
  readonly fix: boolean;
}

function parseArguments(argv: readonly string[]): Options {
  const valueAfter = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    if (index === -1) return undefined;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`${flag} needs a value.`);
    return value;
  };

  return {
    projectId: valueAfter('--project'),
    storeId: valueAfter('--store') ?? process.env.STORE_ID ?? 'romp',
    slug: valueAfter('--slug'),
    fix: argv.includes('--fix'),
  };
}

function fail(message: string): never {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(1);
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

const isEmulated =
  process.env.FIRESTORE_EMULATOR_HOST !== undefined && process.env.FIRESTORE_EMULATOR_HOST !== '';

function resolveProjectId(explicit: string | undefined): string {
  const candidate =
    explicit ??
    process.env.GCLOUD_PROJECT ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.FIREBASE_PROJECT;
  if (candidate === undefined || candidate === '') {
    fail('No Firebase project resolved. Pass --project or set GOOGLE_CLOUD_PROJECT.');
  }
  return candidate;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const projectId = resolveProjectId(options.projectId);
  const app = initializeApp({ projectId }, `reconcile-categories-${String(Date.now())}`);
  const db = getFirestore(app);
  const ctx = createStoreContext({ storeId: options.storeId, db, clock: systemClock });
  const caller = asSystem('category count reconciliation script');

  const slugs =
    options.slug !== undefined
      ? [options.slug]
      : (await listCategories(ctx)).map((category) => category.slug);

  log('');
  log(`Project      ${projectId}${isEmulated ? ' — emulated' : ''}`);
  log(`Mode         ${options.fix ? 'fix' : 'report only'}`);
  log('');
  log('  category            stored    actual');

  let drifted = 0;
  for (const slug of slugs) {
    const report = await reconcileCategoryCount(ctx, caller, slug, { fix: options.fix });
    const flag = report.stored === report.actual ? '' : report.corrected ? '  fixed' : '  DRIFT';
    if (report.stored !== report.actual) drifted += 1;
    log(
      `  ${slug.padEnd(18)} ${String(report.stored).padStart(6)} ${String(report.actual).padStart(9)}${flag}`,
    );
  }

  log('');
  if (drifted === 0) {
    log('All category counts are correct.');
  } else if (options.fix) {
    log(`Corrected ${String(drifted)} drifted categor${drifted === 1 ? 'y' : 'ies'}.`);
  } else {
    log(
      `${String(drifted)} categor${drifted === 1 ? 'y has' : 'ies have'} drifted. Re-run with --fix to correct.`,
    );
  }
  log('');
}

await main();
