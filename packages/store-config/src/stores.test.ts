import { describe, expect, it } from 'vitest';

import { loadStoreConfig, listStoreIds, storeDirectory } from './loader';
import type { StoreConfig } from './schema';
import { publicRuntimeConfig, renderThemeCss } from './tokens';

/**
 * The white-label contract, verified against the real store configs on disk.
 *
 * `docs/WHITE_LABEL.md` promises that creating a store needs zero changes under
 * `apps/` or `packages/`. The way to keep that honest is to hold two genuinely
 * different configs to the same code and assert the *output differs* — a component or
 * emitter that quietly assumes ROMP's dark palette, fonts, feature set or warehouse
 * count fails here rather than in a second store's production build.
 *
 * `_template` is the second config: a light theme, different fonts, different age
 * bands, a different feature set and one warehouse instead of two.
 */

const romp = await loadStoreConfig('romp');
// The scaffold is validated too — otherwise it rots and `pnpm store:new` hands the
// next person a broken config.
const template = await loadStoreConfig('_template', { allowScaffold: true });

describe('the shipped store configs', () => {
  it.each([
    ['romp', romp],
    ['_template', template],
  ])('%s validates, including its contrast gate and asset paths', (_id, config: StoreConfig) => {
    // loadStoreConfig throws on a schema failure, a brand.id mismatch, a contrast
    // failure or a missing asset — so reaching here is the assertion.
    expect(config.brand.name.length).toBeGreaterThan(0);
    expect(config.warehouses.length).toBeGreaterThan(0);
  });

  it('lists deployable stores and excludes the scaffold', () => {
    // Asserted by membership rather than equality: adding a second real store is an
    // expected event and should not break this test.
    const ids = listStoreIds();

    expect(ids).toContain('romp');
    expect(ids).not.toContain('_template');
  });

  it('resolves a store directory under stores/', () => {
    expect(storeDirectory('romp')).toMatch(/[/\\]stores[/\\]romp$/u);
  });
});

describe('the two configs are genuinely different', () => {
  it('differs in brand identity', () => {
    expect(romp.brand.name).not.toBe(template.brand.name);
    expect(romp.brand.orderPrefix).not.toBe(template.brand.orderPrefix);
  });

  it('differs in palette, and in polarity', () => {
    // One dark, one light. An emitter or component that assumed either fails.
    expect(romp.theme.colors.page).not.toBe(template.theme.colors.page);
    expect(romp.theme.colors.primary).not.toBe(template.theme.colors.primary);
  });

  it('differs in typography', () => {
    expect(romp.theme.fonts.display.family).not.toBe(template.theme.fonts.display.family);
    expect(romp.theme.fonts.body.family).not.toBe(template.theme.fonts.body.family);
  });

  it('differs in motion intensity', () => {
    expect(romp.theme.motion.intensity).not.toBe(template.theme.motion.intensity);
  });

  it('differs in feature set, so no component may assume a feature is on', () => {
    expect(romp.features.wishlist).toBe(true);
    expect(template.features.wishlist).toBe(false);
  });

  it('differs in warehouse count, so no UI may assume a number', () => {
    expect(romp.warehouses.length).toBe(2);
    expect(template.warehouses.length).toBe(1);
  });

  it('differs in age taxonomy', () => {
    const rompBands = romp.content.ageBands.map((band) => band.value);
    const templateBands = template.content.ageBands.map((band) => band.value);

    expect(rompBands).not.toEqual(templateBands);
  });

  it('differs in tax rate', () => {
    expect(romp.locale.gstRateBasisPoints).not.toBe(template.locale.gstRateBasisPoints);
  });
});

describe('emitted tokens differ per store', () => {
  const rompCss = renderThemeCss(romp);
  const templateCss = renderThemeCss(template);

  it('produces different stylesheets', () => {
    expect(rompCss).not.toBe(templateCss);
  });

  it('carries the colours of the store it was generated for', () => {
    expect(rompCss).toContain('#d8fd4f');
    expect(rompCss).not.toContain('#5b3df5');
    expect(templateCss).toContain('#5b3df5');
    expect(templateCss).not.toContain('#d8fd4f');
  });

  it('carries the font stack of the store it was generated for', () => {
    expect(rompCss).toContain('"Archivo Black"');
    expect(templateCss).toContain('Fraunces');
  });

  it('scales motion duration by intensity', () => {
    // ROMP is `full` at 220ms; the template is `subtle` at 180ms → 108ms.
    expect(rompCss).toContain('--store-motion-duration: 220ms');
    expect(templateCss).toContain('--store-motion-duration: 108ms');
  });

  it('names the store it was generated for', () => {
    expect(rompCss).toContain('store "romp"');
    expect(templateCss).toContain('store "_template"');
  });
});

describe('publicRuntimeConfig', () => {
  it('excludes warehouse detail from the browser bundle', () => {
    // Warehouse addresses and PIN prefixes are operational detail with no client use.
    const serialised = JSON.stringify(publicRuntimeConfig(romp));

    expect(serialised).not.toContain('Bengaluru hub');
    expect(serialised).not.toContain('560001');
  });

  it('includes what the cart and support links need', () => {
    // No cast: publicRuntimeConfig returns a typed PublicStoreConfig, so a field removed
    // from the public surface breaks this at compile time rather than at runtime.
    const config = publicRuntimeConfig(romp);

    expect(config.features).toBeDefined();
    expect(config.contact.whatsappNumber).toBe('+919845021174');
    expect(config.commerce.freeShippingThresholdMinor).toBe(149_900);
    // The theme is public — it is already in the stylesheet — and the app reads it for
    // themeColor rather than hardcoding a hex.
    expect(config.theme.colors.surfaceDeep).toBe('#0e0e10');
  });
});
