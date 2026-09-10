#!/usr/bin/env node
/**
 * `pnpm seed` — writes a store's configuration into Firestore.
 *
 * What it seeds, in order: warehouses, `settings/checkout`, the order-number counter,
 * categories with rolled-up facet counts, then the catalogue — products, variants,
 * inventory and opening-balance ledger entries.
 *
 * Everything is derived from two files in the repo, so it is repeatable:
 * `stores/<id>/store.config.ts` and `stores/<id>/seed.catalogue.ts`. Re-running updates
 * the same documents rather than creating a second copy, because every seeded document
 * ID is a natural key.
 *
 * Usage:
 *   pnpm seed                          # the store named by STORE_ID, defaulting to romp
 *   pnpm seed --store <id>
 *   pnpm seed --dry-run                # print the plan, write nothing
 *   pnpm seed --reset                  # clear seed-owned collections first (dev only)
 *   pnpm seed --project <projectId>
 *
 * Against the emulators, start them first and export the host variables — or run
 * `pnpm seed:emulator`, which does both.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { loadCatalogueSeed, loadStoreConfig, resolveStoreId } from '@romp/store-config/loader';

import { systemClock } from '../src/clock';
import {
  applySeedPlan,
  buildSeedPlan,
  resetSeededCollections,
  SeedRefusedError,
  summarisePlan,
} from '../src/seed';

interface Options {
  readonly storeId: string | undefined;
  readonly projectId: string | undefined;
  readonly dryRun: boolean;
  readonly reset: boolean;
}

function parseArguments(argv: readonly string[]): Options {
  const valueAfter = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    if (index === -1) return undefined;

    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail(`${flag} needs a value, e.g. \`${flag} romp\`.`);
    }
    return value;
  };

  return {
    storeId: valueAfter('--store'),
    projectId: valueAfter('--project'),
    dryRun: argv.includes('--dry-run'),
    reset: argv.includes('--reset'),
  };
}

function fail(message: string): never {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(1);
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

/**
 * Resolves which project to write to.
 *
 * Explicit flag, then the emulator's own variable, then `GOOGLE_CLOUD_PROJECT`. There is
 * deliberately no default: a seed that guesses a project is a seed that eventually
 * guesses the production one.
 */
function resolveProjectId(explicit: string | undefined): string {
  const candidate =
    explicit ??
    process.env.GCLOUD_PROJECT ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.FIREBASE_PROJECT;

  if (candidate === undefined || candidate === '') {
    fail(
      [
        'No Firebase project resolved.',
        '',
        'Pass one explicitly:      pnpm seed --project romp-dev',
        'Or set the environment:   export GOOGLE_CLOUD_PROJECT=romp-dev',
        '',
        'Against the emulators, `pnpm seed:emulator` sets everything for you.',
      ].join('\n'),
    );
  }

  return candidate;
}

const isEmulated =
  process.env.FIRESTORE_EMULATOR_HOST !== undefined && process.env.FIRESTORE_EMULATOR_HOST !== '';

/**
 * Whether a project is safe to run `--reset` against.
 *
 * `--reset` deletes every document in the seed-owned collections. A flag that wipes a
 * catalogue must not be one keystroke away from doing it to a real store, so it is
 * allowed only on the emulators, on a `demo-` project, or on one whose ID ends in
 * `-dev`. Everything else is refused, including staging — a staging catalogue somebody
 * is testing against is still somebody's afternoon.
 */
function isResettable(projectId: string): boolean {
  return isEmulated || projectId.startsWith('demo-') || projectId.endsWith('-dev');
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const projectId = resolveProjectId(options.projectId);

  // Validated before anything is written, so a broken config or an unresolvable
  // category reference costs nothing.
  const storeId = resolveStoreId(options.storeId, { allowScaffold: true });
  const config = await loadStoreConfig(storeId, { allowScaffold: true });
  const catalogue = await loadCatalogueSeed(storeId, config);

  const plan = buildSeedPlan({ storeId, config, catalogue, clock: systemClock });
  const summary = summarisePlan(plan);

  log('');
  log(`Store        ${storeId} (${config.brand.name})`);
  log(`Project      ${projectId}${isEmulated ? ' — emulated' : ''}`);
  log(`Warehouses   ${String(config.warehouses.length)}`);
  log(
    `Catalogue    ${catalogue === null ? 'none — seed.catalogue.ts not present' : `${String(catalogue.products.length)} products`}`,
  );
  log('');
  log(`${String(plan.writes.length)} documents:`);
  for (const [collection, count] of Object.entries(summary).sort()) {
    log(`  ${collection.padEnd(20)} ${String(count)}`);
  }
  log('');

  if (options.dryRun) {
    // The plan printed here is the same object the writer consumes, so this is the
    // actual outcome rather than an approximation of it.
    for (const write of plan.writes) {
      log(`  ${write.mode === 'createIfAbsent' ? 'create?' : 'write  '} ${write.path}`);
    }
    log('');
    log('Dry run — nothing was written.');
    return;
  }

  const app = initializeApp(
    // Application Default Credentials in CI and on a developer machine that has run
    // `gcloud auth application-default login`; the emulator ignores credentials
    // entirely, which is why none are constructed for it.
    { projectId },
    `seed-${String(Date.now())}`,
  );
  const db = getFirestore(app);

  if (options.reset) {
    if (!isResettable(projectId)) {
      fail(
        [
          `Refusing to --reset "${projectId}".`,
          '',
          '--reset deletes every product, category, warehouse, inventory record and ledger entry.',
          'It is permitted only against the emulators, a demo- project, or a project ending in -dev.',
        ].join('\n'),
      );
    }

    log('Clearing seed-owned collections…');
    await resetSeededCollections(db, {
      onProgress: (message) => {
        log(`  ${message}`);
      },
    });
    log('');
  }

  try {
    const result = await applySeedPlan(db, plan, {
      onProgress: (message) => {
        log(`  ${message}`);
      },
    });

    log('');
    log(
      `Done. ${String(result.updated)} written, ${String(result.created)} created, ${String(result.skipped)} left alone.`,
    );
    if (result.skipped > 0) {
      log(
        'Skipped documents are ones the seed initialises but does not own — settings and counters.',
      );
    }
    log('');
  } catch (error) {
    if (error instanceof SeedRefusedError) {
      fail(error.message);
    }
    throw error;
  }
}

await main();
