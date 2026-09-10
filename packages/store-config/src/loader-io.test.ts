import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { StoreConfigError, assertAssetsExist, loadStoreConfig, storesDirectory } from './loader';
import type { StoreConfig } from './schema';

/**
 * The loader's filesystem paths.
 *
 * Separate from `loader.test.ts`, which validates config *objects*. These cover what
 * happens when the file on disk is wrong, which is the failure a new store actually
 * hits.
 */

describe('storesDirectory', () => {
  it('resolves from this module, not from the working directory', () => {
    // Otherwise the loader would break depending on where a script was invoked from.
    expect(storesDirectory().endsWith('/stores')).toBe(true);
  });
});

describe('loadStoreConfig', () => {
  it('refuses a store directory that does not exist', async () => {
    await expect(loadStoreConfig('does-not-exist')).rejects.toThrow(StoreConfigError);
  });

  it('refuses a scaffold unless explicitly allowed', async () => {
    await expect(loadStoreConfig('_template')).rejects.toThrow(/scaffold/);
    await expect(loadStoreConfig('_template', { allowScaffold: true })).resolves.toBeDefined();
  });

  it('loads and validates the real ROMP config', async () => {
    const config = await loadStoreConfig('romp');

    expect(config.brand.id).toBe('romp');
    // Proves the contrast gate and asset existence check both ran and passed.
    expect(config.theme.colors.primary).toBe('#d8fd4f');
  });
});

/**
 * These need a real directory under `stores/`, because that is what the loader reads.
 * Each test creates one with a unique name and removes it in `finally`, so a failure
 * cannot leave a stray store behind that later shows up in `listStoreIds()`.
 */
describe('loadStoreConfig, when the file on disk is wrong', () => {
  function withTemporaryStore(
    contents: string | null,
    assertion: (storeId: string) => Promise<void>,
  ): Promise<void> {
    const storeId = `tmp-${String(Date.now())}-${String(Math.floor(Math.random() * 10_000))}`;
    const directory = join(storesDirectory(), storeId);
    mkdirSync(directory, { recursive: true });
    if (contents !== null) {
      writeFileSync(join(directory, 'store.config.ts'), contents, 'utf8');
    }

    return assertion(storeId).finally(() => {
      rmSync(directory, { recursive: true, force: true });
    });
  }

  it('reports a missing store.config.ts', async () => {
    await withTemporaryStore(null, async (storeId) => {
      await expect(loadStoreConfig(storeId)).rejects.toThrow(/store\.config\.ts does not exist/);
    });
  });

  it('reports a config file that throws while being imported', async () => {
    await withTemporaryStore(`throw new Error('boom from the config');\n`, async (storeId) => {
      await expect(loadStoreConfig(storeId)).rejects.toThrow(/could not be imported/);
    });
  });

  it('reports a config file with no default export', async () => {
    // The likely mistake is `export const config = …` instead of `export default`.
    await withTemporaryStore(`export const config = { brand: {} };\n`, async (storeId) => {
      await expect(loadStoreConfig(storeId)).rejects.toThrow(/must have a default export/);
    });
  });
});

describe('assertAssetsExist', () => {
  function configWithAssets(paths: {
    dark: string;
    light: string;
    mark: string;
    favicon: string;
    og: string;
  }): StoreConfig {
    return {
      brand: {
        id: 'romp',
        name: 'ROMP',
        legalName: 'ROMP Retail Private Limited',
        tagline: 'T',
        orderPrefix: 'RMP',
        logos: {
          dark: paths.dark,
          light: paths.light,
          mark: paths.mark,
          favicon: paths.favicon,
        },
        ogFallback: paths.og,
      },
    } as unknown as StoreConfig;
  }

  it('passes when every asset is present', () => {
    expect(() => {
      assertAssetsExist(
        'romp',
        configWithAssets({
          dark: 'assets/logo-dark.svg',
          light: 'assets/logo-light.svg',
          mark: 'assets/mark.svg',
          favicon: 'assets/favicon.svg',
          og: 'assets/og-fallback.png',
        }),
      );
    }).not.toThrow();
  });

  it('names every missing asset, not just the first', () => {
    // The common new-store mistake is renaming or forgetting several at once.
    let thrown: unknown;
    try {
      assertAssetsExist(
        'romp',
        configWithAssets({
          dark: 'assets/nope-dark.svg',
          light: 'assets/logo-light.svg',
          mark: 'assets/nope-mark.svg',
          favicon: 'assets/favicon.svg',
          og: 'assets/og-fallback.png',
        }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(StoreConfigError);
    const message = (thrown as Error).message;
    expect(message).toContain('2 missing assets');
    expect(message).toContain('assets/nope-dark.svg');
    expect(message).toContain('assets/nope-mark.svg');
  });

  it('uses the singular for one missing asset', () => {
    expect(() => {
      assertAssetsExist(
        'romp',
        configWithAssets({
          dark: 'assets/logo-dark.svg',
          light: 'assets/logo-light.svg',
          mark: 'assets/mark.svg',
          favicon: 'assets/favicon.svg',
          og: 'assets/gone.png',
        }),
      );
    }).toThrow(/1 missing asset:/);
  });

  it('accepts an absolute path', () => {
    const directory = mkdtempSync(join(tmpdir(), 'romp-assets-'));
    const absolute = join(directory, 'logo.svg');
    writeFileSync(absolute, '<svg/>', 'utf8');

    try {
      expect(() => {
        assertAssetsExist(
          'romp',
          configWithAssets({
            dark: absolute,
            light: 'assets/logo-light.svg',
            mark: 'assets/mark.svg',
            favicon: 'assets/favicon.svg',
            og: 'assets/og-fallback.png',
          }),
        );
      }).not.toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
