#!/usr/bin/env node
/**
 * `pnpm reconcile:variant` — reconciles a variant's stock against its ledger.
 *
 * The materialised balance (`inventory/{variantId}`) and the append-only `inventoryLedger`
 * must never drift: the sum of a warehouse's ledger deltas should equal its stored on-hand.
 * This script sums the ledger per warehouse, compares it to the stored balance, and reports
 * any divergence — the read half of runbook 4 (oversell reconciliation).
 *
 * When a physical count says the stored number is simply wrong, `--fix` corrects it. The
 * runbook is explicit that adjustments are entries, never edits: so `--fix` does not overwrite
 * the balance, it writes a `reconciliation` ledger entry whose delta moves the warehouse to the
 * physically verified number, in one transaction with the balance update. That keeps the ledger
 * the source of truth and leaves an auditable record of the correction.
 *
 * Usage:
 *   pnpm reconcile:variant --variant WB-240                         # report only
 *   pnpm reconcile:variant --variant WB-240 --project romp-dev
 *   pnpm reconcile:variant --variant WB-240 --fix --warehouse blr --count 40 --note "INC-123"
 *
 * Against the emulators, start them and export the host variables first.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { systemClock } from '../src/clock';
import { asSystem, createStoreContext } from '../src/context';
import { findInventory, reconcileVariantStock } from '../src/repositories/inventory';
import { adjustInventory } from '../src/repositories/inventory-write';

interface Options {
  readonly variantId: string | undefined;
  readonly projectId: string | undefined;
  readonly storeId: string;
  readonly fix: boolean;
  readonly warehouseId: string | undefined;
  readonly count: number | undefined;
  readonly note: string | undefined;
}

function parseArguments(argv: readonly string[]): Options {
  const valueAfter = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    if (index === -1) return undefined;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail(`${flag} needs a value.`);
    }
    return value;
  };

  const countRaw = valueAfter('--count');
  return {
    variantId: valueAfter('--variant'),
    projectId: valueAfter('--project'),
    storeId: valueAfter('--store') ?? process.env.STORE_ID ?? 'romp',
    fix: argv.includes('--fix'),
    warehouseId: valueAfter('--warehouse'),
    count: countRaw === undefined ? undefined : Number(countRaw),
    note: valueAfter('--note'),
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
  if (options.variantId === undefined) {
    fail('A variant is required: pnpm reconcile:variant --variant WB-240');
  }

  const projectId = resolveProjectId(options.projectId);
  const app = initializeApp({ projectId }, `reconcile-${String(Date.now())}`);
  const db = getFirestore(app);
  const ctx = createStoreContext({ storeId: options.storeId, db, clock: systemClock });
  const caller = asSystem('inventory reconciliation script');

  const report = await reconcileVariantStock(ctx, caller, options.variantId);

  log('');
  log(`Variant      ${report.variantId}`);
  log(`Project      ${projectId}${isEmulated ? ' — emulated' : ''}`);
  log(`Ledger rows  ${String(report.entryCount)}`);
  log(`Balanced     ${report.balanced ? 'yes' : 'NO — discrepancy'}`);
  log('');

  const warehouses = [
    ...new Set([
      ...Object.keys(report.ledgerByWarehouse),
      ...Object.keys(report.storedByWarehouse),
    ]),
  ].sort();
  log('  warehouse         ledger    stored    diff');
  for (const warehouseId of warehouses) {
    const ledger = report.ledgerByWarehouse[warehouseId] ?? 0;
    const stored = report.storedByWarehouse[warehouseId] ?? 0;
    const diff = stored - ledger;
    log(
      `  ${warehouseId.padEnd(16)} ${String(ledger).padStart(6)} ${String(stored).padStart(9)} ${
        diff === 0 ? '       ok' : String(diff).padStart(9)
      }`,
    );
  }
  log('');

  if (!options.fix) {
    if (!report.balanced) {
      log('Discrepancy found. Re-run with --fix --warehouse <id> --count <verified> --note <ref>');
      log('to write a reconciliation adjustment that sets the warehouse to the physical count.');
      log('');
    }
    return;
  }

  // --fix: correct the stored balance for one warehouse to the physically verified count, by
  // writing a reconciliation adjustment (an entry, never an edit) whose delta closes the gap.
  if (options.warehouseId === undefined || options.count === undefined) {
    fail('--fix needs --warehouse <id> and --count <physically verified number>.');
  }
  if (!Number.isInteger(options.count) || options.count < 0) {
    fail('--count must be a whole, non-negative number of units.');
  }

  const current = await findInventory(ctx, caller, options.variantId);
  const currentStored =
    (current?.stock as Record<string, number> | undefined)?.[options.warehouseId] ?? 0;
  const delta = options.count - currentStored;

  if (delta === 0) {
    log(
      `Warehouse ${options.warehouseId} already reads ${String(options.count)}. Nothing to correct.`,
    );
    log('');
    return;
  }

  const result = await adjustInventory(ctx, caller, {
    variantId: options.variantId,
    productId: current?.productId ?? options.variantId,
    warehouseId: options.warehouseId,
    delta,
    reason: 'reconciliation',
    note: options.note ?? 'Reconciliation to physical count.',
    refId: null,
    lowStockThreshold: current?.lowStockThreshold ?? 0,
  });

  log(
    `Corrected ${options.warehouseId}: ${String(currentStored)} → ${String(options.count)} (delta ${
      delta > 0 ? '+' : ''
    }${String(delta)}). On-hand total now ${String(result.onHandTotal)}.`,
  );
  log(`Ledger entry ${result.ledgerEntryId} written with reason "reconciliation".`);
  log('');
}

await main();
