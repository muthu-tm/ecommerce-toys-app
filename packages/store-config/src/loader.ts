import { existsSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { z } from 'zod';

import { assertContrast } from './contrast';
import { CatalogueSeedSchema, StoreConfigSchema, brandAssetPaths } from './schema';
import type { CatalogueSeed, StoreConfig } from './schema';

/**
 * The fail-fast loader.
 *
 * A malformed store config fails the **build**, not a page render. The distinction is
 * the whole point: a validation error thrown from a React component surfaces as a
 * half-branded page in production at whatever moment that route is first requested. Run
 * from the generator and from CI, it surfaces as a build failure with the exact path.
 *
 * Node-only — it touches the filesystem. Apps consume the *generated* artefacts, never
 * this module.
 */

/** Repo root, derived from this file rather than from `process.cwd()`. */
function repoRoot(): string {
  // src/ -> package root -> packages/ -> repo root
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

export function storesDirectory(): string {
  return join(repoRoot(), 'stores');
}

export function storeDirectory(storeId: string): string {
  return join(storesDirectory(), storeId);
}

export class StoreConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreConfigError';
  }
}

export interface StoreIdOptions {
  /**
   * Permit a `_`-prefixed directory such as `_template`.
   *
   * Off by default, so a scaffold can never be deployed as if it were a store. It is
   * switched on only to *validate* the scaffold — which has to happen, or `_template`
   * rots into an invalid state and the next `pnpm store:new` hands someone a broken
   * config.
   */
  readonly allowScaffold?: boolean;
}

/**
 * Resolves which store to build.
 *
 * Defaults to `romp` when `STORE_ID` is unset, so a plain `pnpm dev` works. It does
 * **not** silently fall back when the variable is set to something that does not exist
 * — a typo in a deploy workflow input must fail loudly rather than quietly shipping the
 * wrong brand.
 */
export function resolveStoreId(explicit?: string, options: StoreIdOptions = {}): string {
  const candidate = explicit ?? process.env.STORE_ID ?? 'romp';
  const pattern = options.allowScaffold === true ? /^_?[a-z][a-z0-9-]*$/u : /^[a-z][a-z0-9-]*$/u;

  if (!pattern.test(candidate)) {
    throw new StoreConfigError(
      candidate.startsWith('_')
        ? `"${candidate}" is a scaffold, not a deployable store. A leading underscore is reserved for templates.`
        : `STORE_ID "${candidate}" is not a valid store ID (lowercase alphanumeric with hyphens).`,
    );
  }

  if (!existsSync(storeDirectory(candidate))) {
    throw new StoreConfigError(
      `No store directory at stores/${candidate}. Create one with \`pnpm store:new ${candidate}\`.`,
    );
  }

  return candidate;
}

/**
 * Validates a config object that has already been imported.
 *
 * Separate from the file loading so the same validation runs against fixtures in tests
 * without touching disk, and so the error messages are identical either way.
 */
export function validateStoreConfig(
  storeId: string,
  raw: unknown,
  options: { readonly checkAssets?: boolean } = {},
): StoreConfig {
  const result = StoreConfigSchema.safeParse(raw);

  if (!result.success) {
    throw new StoreConfigError(
      `stores/${storeId}/store.config.ts is invalid:\n${formatZodIssues(result.error)}`,
    );
  }

  const config = result.data;

  // The directory name is the store's identity — it appears in paths, in the deploy
  // workflow input, and in `.firebaserc`. A mismatch means the config being edited is
  // not the config being built.
  if (config.brand.id !== storeId) {
    throw new StoreConfigError(
      `brand.id is "${config.brand.id}" but the directory is stores/${storeId}. They must match.`,
    );
  }

  // Contrast is a release gate. A rebrand cannot ship a palette that fails WCAG AA —
  // and when a store ships both a light and a dark palette, both are gated independently,
  // so a light theme can no more ship an unreadable pair than a dark one can.
  assertContrast(storeId, config.theme.colors);
  if (config.theme.modes !== undefined) {
    assertContrast(`${storeId} (light)`, config.theme.modes.light);
    assertContrast(`${storeId} (dark)`, config.theme.modes.dark);
  }

  if (options.checkAssets !== false) {
    assertAssetsExist(storeId, config);
  }

  return config;
}

/**
 * Confirms every referenced asset exists.
 *
 * This is what catches the most common new-store mistake: editing the config but
 * forgetting to replace the template's placeholder artwork, or renaming a file and not
 * the reference. A missing logo is a 404 in the header on the busiest page.
 */
export function assertAssetsExist(storeId: string, config: StoreConfig): void {
  const directory = storeDirectory(storeId);
  const missing = brandAssetPaths(config.brand).filter((assetPath) => {
    const absolute = isAbsolute(assetPath) ? assetPath : join(directory, assetPath);
    return !existsSync(absolute);
  });

  if (missing.length > 0) {
    throw new StoreConfigError(
      `stores/${storeId} references ${String(missing.length)} missing asset${missing.length === 1 ? '' : 's'}:\n${missing.map((path) => `  ${path}`).join('\n')}`,
    );
  }
}

/**
 * Loads and validates the active store config.
 *
 * The dynamic import is why this is async. It is called from build-time scripts, never
 * from a request path.
 */
export async function loadStoreConfig(
  explicitStoreId?: string,
  options: StoreIdOptions = {},
): Promise<StoreConfig> {
  const storeId = resolveStoreId(explicitStoreId, options);
  const modulePath = join(storeDirectory(storeId), 'store.config.ts');

  if (!existsSync(modulePath)) {
    throw new StoreConfigError(`stores/${storeId}/store.config.ts does not exist.`);
  }

  let imported: unknown;
  try {
    imported = (await import(modulePath)) as unknown;
  } catch (cause) {
    throw new StoreConfigError(
      `stores/${storeId}/store.config.ts could not be imported: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const raw = (imported as { default?: unknown }).default;
  if (raw === undefined) {
    throw new StoreConfigError(
      `stores/${storeId}/store.config.ts must have a default export — use \`export default defineStoreConfig({ … })\`.`,
    );
  }

  return validateStoreConfig(storeId, raw);
}

/**
 * Validates a seed catalogue against the store config that has to accept it.
 *
 * The schema can check a catalogue is internally consistent — unique slugs, unique
 * SKUs, MRP above price. It cannot check that `category: 'building-sets'` names a
 * category this store actually has, because it has never seen the config. That
 * cross-check is the whole reason this function exists, and it is the check that
 * matters: a product pointing at a missing category seeds a document nothing links
 * to and no filter finds, which looks like a rendering bug for as long as it takes
 * someone to compare two files by hand.
 *
 * Every reference is reported at once rather than one per run. A seed author fixing
 * fourteen typos should not need fourteen runs to find them.
 */
export function validateCatalogueSeed(
  storeId: string,
  config: StoreConfig,
  raw: unknown,
  options: { readonly checkAssets?: boolean } = {},
): CatalogueSeed {
  const result = CatalogueSeedSchema.safeParse(raw);

  if (!result.success) {
    throw new StoreConfigError(
      `stores/${storeId}/seed.catalogue.ts is invalid:\n${formatZodIssues(result.error)}`,
    );
  }

  const catalogue = result.data;
  const categorySlugs = new Set(config.content.categories.map((category) => category.slug));
  const ageBandValues = new Set(config.content.ageBands.map((band) => band.value));
  const warehouseCodes = new Set(config.warehouses.map((warehouse) => warehouse.code));

  const problems: string[] = [];

  for (const [index, product] of catalogue.products.entries()) {
    const at = `products.${String(index)} (${product.slug})`;

    if (!categorySlugs.has(product.category)) {
      problems.push(
        `${at}: category "${product.category}" is not in content.categories. Available: ${[...categorySlugs].join(', ')}`,
      );
    }
    if (!ageBandValues.has(product.ageBand)) {
      problems.push(
        `${at}: ageBand "${product.ageBand}" is not in content.ageBands. Available: ${[...ageBandValues].join(', ')}`,
      );
    }

    for (const [variantIndex, variant] of product.variants.entries()) {
      for (const code of Object.keys(variant.stock)) {
        if (!warehouseCodes.has(code)) {
          problems.push(
            `${at}.variants.${String(variantIndex)} (${variant.sku}): stock references warehouse "${code}", which is not configured. Available: ${[...warehouseCodes].join(', ')}`,
          );
        }
      }
    }

    if (options.checkAssets !== false) {
      for (const [mediaIndex, media] of product.media.entries()) {
        const absolute = join(storeDirectory(storeId), 'assets', 'catalogue', media.file);
        if (!existsSync(absolute)) {
          problems.push(
            `${at}.media.${String(mediaIndex)}: assets/catalogue/${media.file} does not exist.`,
          );
        }
      }
    }
  }

  if (problems.length > 0) {
    throw new StoreConfigError(
      `stores/${storeId}/seed.catalogue.ts references things the store config does not have:\n${problems.map((problem) => `  ${problem}`).join('\n')}`,
    );
  }

  return catalogue;
}

/**
 * Loads and validates a store's seed catalogue.
 *
 * The file is **optional**. A store with no `seed.catalogue.ts` seeds its
 * warehouses, categories and settings and stops — which is the right behaviour for
 * a store whose real catalogue is being imported from elsewhere, and it means
 * `pnpm seed` is still useful on day one of a new store.
 */
export async function loadCatalogueSeed(
  storeId: string,
  config: StoreConfig,
): Promise<CatalogueSeed | null> {
  const modulePath = join(storeDirectory(storeId), 'seed.catalogue.ts');
  if (!existsSync(modulePath)) return null;

  let imported: unknown;
  try {
    imported = (await import(modulePath)) as unknown;
  } catch (cause) {
    throw new StoreConfigError(
      `stores/${storeId}/seed.catalogue.ts could not be imported: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const raw = (imported as { default?: unknown }).default;
  if (raw === undefined) {
    throw new StoreConfigError(
      `stores/${storeId}/seed.catalogue.ts must have a default export — use \`export default defineCatalogueSeed({ … })\`.`,
    );
  }

  return validateCatalogueSeed(storeId, config, raw);
}

/** Every store directory present in the repo, for the multi-store CI matrix. */
export function listStoreIds(): readonly string[] {
  const directory = storesDirectory();
  if (!existsSync(directory)) return [];

  return (
    readdirSync(directory, { withFileTypes: true })
      // `_template` is a scaffold, not a store. Leading underscore marks it as such.
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
      .map((entry) => entry.name)
      .sort()
  );
}

/** Renders Zod issues with the exact path, which is what makes a failure actionable. */
function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length === 0 ? '(root)' : issue.path.map(String).join('.');
      return `  ${path}: ${issue.message}`;
    })
    .join('\n');
}
