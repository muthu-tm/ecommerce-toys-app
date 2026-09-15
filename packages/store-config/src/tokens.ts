import type { StoreConfig } from './schema';
import type { MotionIntensity, Theme, ThemeColors } from './schema/theme';

/**
 * Token emission.
 *
 * The theme reaches components two ways, from one source:
 *
 *  - **CSS custom properties**, so an inline style or a raw CSS rule never needs a
 *    literal.
 *  - **A Tailwind theme extension**, so a utility class never needs an arbitrary
 *    value like `bg-[#d8fd4f]`.
 *
 * Both are required. With only one of them, the `no-hardcoded-brand` lint rule would
 * have to permit literals in whichever context was uncovered, and a rule with an
 * escape hatch that wide catches nothing.
 */

/**
 * Custom-property namespace.
 *
 * Deliberately **not** the brand name. `--romp-color-primary` would put the first
 * store's name in every other store's stylesheet, which is exactly the leak the
 * white-label contract exists to prevent — and it would make the `no-hardcoded-brand`
 * lint rule fire on every legitimate token reference, forcing an exemption that would
 * then hide real violations.
 */
export const TOKEN_PREFIX = 'store';

/** Motion scale per intensity. `none` collapses durations to zero. */
const MOTION_SCALE: Readonly<Record<MotionIntensity, number>> = Object.freeze({
  full: 1,
  subtle: 0.6,
  none: 0,
});

/** Kebab-case, the convention for CSS custom properties and Tailwind token names. */
function kebab(name: string): string {
  return name.replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
}

function cssVar(group: string, name: string): string {
  return `--${TOKEN_PREFIX}-${group}-${kebab(name)}`;
}

/**
 * The custom property `next/font` is told to define for a configured face.
 *
 * The generated font module (see `renderFontsModule`) passes this as next/font's
 * `variable` option, and the theme stylesheet references it. That indirection is what
 * lets a font be configuration: the family name appears in the generated module, and
 * everything downstream refers to the variable.
 */
export function fontCssVariable(role: 'display' | 'body'): string {
  return `--font-${TOKEN_PREFIX}-${role}`;
}

/**
 * The full colour ramp for a palette, with derived fallbacks applied.
 *
 * `surfaceElevated` is optional in a store config; when omitted it resolves to `surface`,
 * so the `bg-surface-elevated` utility always exists and always has a sensible value. This
 * is the one place that fallback is computed, so both the CSS-property emission and the
 * mode-override emission agree.
 */
export function resolvedColorEntries(colors: ThemeColors): readonly (readonly [string, string])[] {
  const surfaceElevated = colors.surfaceElevated ?? colors.surface;
  return Object.entries({ ...colors, surfaceElevated });
}

/** Flat map of custom property name to value, for the default palette. */
export function themeCustomProperties(theme: Theme): Readonly<Record<string, string>> {
  const properties: Record<string, string> = {};

  for (const [name, value] of resolvedColorEntries(theme.colors)) {
    properties[cssVar('color', name)] = value;
  }
  for (const [name, value] of Object.entries(theme.radii)) {
    properties[cssVar('radius', name)] = value;
  }
  for (const [name, value] of Object.entries(theme.shadows)) {
    properties[cssVar('shadow', name)] = value;
  }

  // `var(--font-store-display, "Archivo Black"), ui-sans-serif, …`
  //
  // The first entry is the variable `next/font` defines once the webfont is loaded. Its
  // fallback is the literal family name, which covers a locally-installed copy and any
  // consumer not running through next/font. Then the configured fallback stack. One
  // declaration that is correct in all three cases, with no branching.
  properties[cssVar('font', 'display')] =
    `var(${fontCssVariable('display')}, ${fontStack(theme.fonts.display)})`;
  properties[cssVar('font', 'body')] =
    `var(${fontCssVariable('body')}, ${fontStack(theme.fonts.body)})`;

  const scaled = Math.round(theme.motion.durationMs * MOTION_SCALE[theme.motion.intensity]);
  properties[cssVar('motion', 'duration')] = `${String(scaled)}ms`;
  properties[cssVar('motion', 'easing')] = theme.motion.easing;
  properties[cssVar('motion', 'intensity')] = theme.motion.intensity;

  return properties;
}

/**
 * A CSS font stack.
 *
 * Families containing spaces are quoted, or the declaration is invalid and the browser
 * silently falls through to the next entry — which looks like a font that failed to
 * load rather than a malformed stack.
 */
export function fontStack(font: { family: string; fallback: readonly string[] }): string {
  const quote = (family: string): string => (/[^\w-]/u.test(family) ? `"${family}"` : family);

  return [font.family, ...font.fallback].map(quote).join(', ');
}

/**
 * The generated stylesheet.
 *
 * Emitted into a gitignored `generated/` directory and imported by each app's root
 * layout. It carries a header naming the store and the generator, because the first
 * question anyone asks about a generated file is where it came from.
 *
 * `prefers-reduced-motion` is honoured here, at the token level, rather than in every
 * component. A component that forgets to check the media query still animates for
 * zero milliseconds — the safe default, and the reason this belongs in the emitter
 * rather than in a hook.
 */
export function renderThemeCss(config: StoreConfig): string {
  const properties = themeCustomProperties(config.theme);
  const declarations = Object.entries(properties)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');

  return `${renderTailwindThemeCss(config.theme)}
/*
 * Generated by @romp/store-config for store "${config.brand.id}".
 * Do not edit: run \`pnpm store:tokens\` instead. Source of truth is
 * stores/${config.brand.id}/store.config.ts.
 */
:root {
${declarations}
}
${renderModeOverrides(config.theme)}${renderThemeModeUtilities(config.theme)}
/*
 * prefers-reduced-motion wins over theme.motion.intensity, always. Handled here so a
 * component that forgets the media query still animates for zero milliseconds.
 */
@media (prefers-reduced-motion: reduce) {
  :root {
    ${cssVar('motion', 'duration')}: 0ms;
  }
}
`;
}

/**
 * Utility classes that show an element only in one theme mode.
 *
 * `.theme-dark-only` is visible when the active theme is dark, `.theme-light-only` when it is
 * light — driven by the *same* `data-theme` / `prefers-color-scheme` logic the palette uses, so
 * an asset that must match the surface (a wordmark whose ink is light on dark and dark on light)
 * can never mismatch it. Emitted for every store; a single-theme store simply always resolves to
 * its one mode. The class only sets `display: none` for the hidden variant, so an element with
 * neither class is unaffected.
 */
function renderThemeModeUtilities(theme: Theme): string {
  // Single-theme store: the active mode is always `defaultMode`, so the rule is unconditional.
  if (theme.modes === undefined) {
    const hideOther = theme.defaultMode === 'dark' ? 'light' : 'dark';
    return `
.theme-${hideOther}-only { display: none; }
`;
  }

  const nonDefaultMode = theme.defaultMode === 'dark' ? 'light' : 'dark';

  return `
/*
 * Theme-scoped visibility, mirroring the palette selectors above so a themed asset (e.g. the
 * wordmark) always matches its surface.
 */
:root .theme-${nonDefaultMode}-only { display: none; }
[data-theme='light'] .theme-dark-only { display: none; }
[data-theme='light'] .theme-light-only { display: revert; }
[data-theme='dark'] .theme-light-only { display: none; }
[data-theme='dark'] .theme-dark-only { display: revert; }
@media (prefers-color-scheme: ${nonDefaultMode}) {
  :root:not([data-theme]) .theme-${theme.defaultMode}-only { display: none; }
  :root:not([data-theme]) .theme-${nonDefaultMode}-only { display: revert; }
}
`;
}

/** Colour declarations for one palette, indented for a rule body. */
function paletteColorDeclarations(colors: ThemeColors): string {
  return resolvedColorEntries(colors)
    .map(([name, value]) => `  ${cssVar('color', name)}: ${value};`)
    .join('\n');
}

/**
 * Light/dark mode override blocks.
 *
 * Emitted only when a store ships `theme.modes`. Three things are produced:
 *
 *  - An explicit `[data-theme="light"]` and `[data-theme="dark"]` block, so the toggle can
 *    force a palette regardless of the OS preference by setting `data-theme` on `<html>`.
 *  - A `@media (prefers-color-scheme)` block that applies the palette a no-preference
 *    visitor should see *when the toggle has not run yet* — i.e. only while `<html>` carries
 *    no explicit `data-theme`. This is what makes the OS preference the initial default
 *    without a flash, in concert with the no-flash inline script the ThemeProvider injects.
 *
 * `:root` already holds `theme.colors` (the `defaultMode` palette), so a single-theme store
 * and a JS-disabled visitor both get a complete, valid palette with no override at all.
 */
function renderModeOverrides(theme: Theme): string {
  if (theme.modes === undefined) return '';

  const { light, dark } = theme.modes;
  const nonDefaultMode = theme.defaultMode === 'dark' ? 'light' : 'dark';
  const nonDefaultColors = theme.defaultMode === 'dark' ? light : dark;

  return `
/*
 * Explicit theme selection. The ThemeProvider sets \`data-theme\` on <html>; these win
 * over the OS preference and over :root.
 */
[data-theme='light'] {
${paletteColorDeclarations(light)}
}

[data-theme='dark'] {
${paletteColorDeclarations(dark)}
}

/*
 * OS preference, applied only until the visitor makes an explicit choice. Scoped to
 * :root:not([data-theme]) so a forced theme is never overridden by the media query.
 */
@media (prefers-color-scheme: ${nonDefaultMode}) {
  :root:not([data-theme]) {
${paletteColorDeclarations(nonDefaultColors)}
  }
}
`;
}

/**
 * Tailwind theme block.
 *
 * Tailwind 4 is configured in CSS, not JavaScript, so this emits an `@theme` block
 * rather than a JS object. Utilities like `bg-primary`, `rounded-md` and `font-display`
 * come from here.
 *
 * `@theme inline` matters: it makes the generated utilities emit
 * `background-color: var(--store-color-primary)` rather than copying the resolved value
 * at build time. Without `inline`, a store switch would need a Tailwind rebuild instead
 * of just a different stylesheet — and the `:root` override would be ignored.
 *
 * Every value is a `var(...)` reference, so there is exactly one place a colour is
 * written. The Tailwind surface is identical for every store; only the values in
 * `:root` differ.
 */
export function renderTailwindThemeCss(theme: Theme): string {
  const lines: string[] = [];

  // Tailwind 4 namespaces: --color-*, --radius-*, --shadow-*, --font-*, --ease-*.
  //
  // The colour surface is derived from `resolvedColorEntries` rather than the raw config,
  // so `surface-elevated` is always present (falling back to `surface`) and the Tailwind
  // utility set is identical for every store whether or not it defines that optional token.
  const colorNames = resolvedColorEntries(theme.colors).map(([name]) => name);
  for (const name of colorNames) {
    lines.push(`  --color-${kebab(name)}: var(${cssVar('color', name)});`);
  }
  for (const name of Object.keys(theme.radii)) {
    lines.push(`  --radius-${kebab(name)}: var(${cssVar('radius', name)});`);
  }
  for (const name of Object.keys(theme.shadows)) {
    lines.push(`  --shadow-${kebab(name)}: var(${cssVar('shadow', name)});`);
  }
  lines.push(`  --font-display: var(${cssVar('font', 'display')});`);
  lines.push(`  --font-body: var(${cssVar('font', 'body')});`);
  lines.push(`  --ease-theme: var(${cssVar('motion', 'easing')});`);

  return `@theme inline {\n${lines.join('\n')}\n}\n`;
}

/**
 * The export name `next/font/google` uses for a family.
 *
 * next/font/google exports one identifier per family, with spaces as underscores:
 * "Archivo Black" is `Archivo_Black`.
 */
export function googleFontExportName(family: string): string {
  return family.trim().replaceAll(/\s+/gu, '_');
}

/**
 * Generates the app's font module.
 *
 * `next/font` is **statically analysed** — `import { Archivo } from 'next/font/google'`
 * with a literal family name. There is no runtime API, so a font cannot be read from a
 * config object at request time. Generating this module is what makes typography
 * configuration rather than code: the family name appears here, produced from the store
 * config, and every consumer refers to the CSS variable instead.
 *
 * The module exports `fontClassName`, which the root layout puts on `<html>` so both
 * variables are in scope for the whole document.
 */
export function renderFontsModule(config: StoreConfig): string {
  const { display, body } = config.theme.fonts;

  const googleFaces = [
    { role: 'display' as const, font: display },
    { role: 'body' as const, font: body },
  ].filter((entry) => entry.font.source === 'google');

  const localFaces = [
    { role: 'display' as const, font: display },
    { role: 'body' as const, font: body },
  ].filter((entry) => entry.font.source === 'local');

  const imports = googleFaces
    .map(
      (entry) => `import { ${googleFontExportName(entry.font.family)} } from 'next/font/google';`,
    )
    .filter((line, index, all) => all.indexOf(line) === index)
    .join('\n');

  const declarations = googleFaces
    .map((entry) => {
      const identifier = googleFontExportName(entry.font.family);
      const weights = entry.font.weights.map((weight) => `'${String(weight)}'`).join(', ');
      return `const ${entry.role}Font = ${identifier}({
  subsets: ['latin'],
  weight: [${weights}],
  variable: '${fontCssVariable(entry.role)}',
  // 'swap' so text is painted in the fallback immediately rather than being invisible
  // while the webfont loads. Invisible text is a worse LCP than a font swap.
  display: 'swap',
});`;
    })
    .join('\n\n');

  const unsupported =
    localFaces.length === 0
      ? ''
      : `\n// ${localFaces.map((entry) => entry.role).join(' and ')} use source: 'local'.\n// Self-hosted faces are declared with next/font/local and files under\n// stores/${config.brand.id}/fonts/. Not generated automatically, because the file names\n// and weights are specific to the licensed files supplied.\n`;

  // Concatenated with spaces, not comma-joined — a comma here produces a sequence
  // expression whose value is only the last variable, so one of the two fonts would
  // silently never reach the document.
  const classNames = googleFaces.map((entry) => `${entry.role}Font.variable`).join(" + ' ' + ");

  return `// Generated by @romp/store-config for store "${config.brand.id}". Do not edit.
// Run \`pnpm store:tokens\` to regenerate.
//
// next/font is statically analysed, so the family name has to appear literally in a
// module like this one. Generating it is what keeps typography in store config.
${imports}
${unsupported}
${declarations}

/** Put this on <html> so both font variables are in scope for the whole document. */
export const fontClassName = ${classNames.length > 0 ? classNames : "''"};
`;
}

/**
 * The subset of config safe to expose to the browser bundle.
 *
 * Everything here is already public — a wordmark, copy, feature flags, the UPI VPA that
 * appears in a QR code customers scan. Warehouse addresses and PIN prefixes are
 * excluded: they are operational detail with no client use, and shipping them would put
 * the store's logistics footprint in a public bundle for no reason.
 */
export interface PublicStoreConfig {
  readonly brand: StoreConfig['brand'];
  /**
   * Included because it is already public: every one of these values is in the emitted
   * stylesheet the browser downloads. Exposing it here as data too means the handful of
   * places that need a colour in JavaScript rather than CSS — `themeColor` for the browser
   * chrome, a canvas, a generated OG image — can read it from config instead of
   * hardcoding a hex.
   */
  readonly theme: StoreConfig['theme'];
  readonly locale: StoreConfig['locale'];
  readonly content: StoreConfig['content'];
  readonly contact: StoreConfig['contact'];
  readonly features: StoreConfig['features'];
  readonly commerce: {
    readonly giftWrapFeeMinor: StoreConfig['commerce']['giftWrapFeeMinor'];
    readonly expressFeeMinor: StoreConfig['commerce']['expressFeeMinor'];
    readonly freeShippingThresholdMinor: StoreConfig['commerce']['freeShippingThresholdMinor'];
    readonly reservationTtlMinutes: StoreConfig['commerce']['reservationTtlMinutes'];
    readonly maxQtyPerLine: StoreConfig['commerce']['maxQtyPerLine'];
    readonly upi: StoreConfig['commerce']['upi'];
  };
}

export function publicRuntimeConfig(config: StoreConfig): PublicStoreConfig {
  return {
    brand: config.brand,
    theme: config.theme,
    locale: config.locale,
    content: config.content,
    contact: config.contact,
    features: config.features,
    commerce: {
      // Fee and threshold values render in the cart, so the client needs them.
      giftWrapFeeMinor: config.commerce.giftWrapFeeMinor,
      expressFeeMinor: config.commerce.expressFeeMinor,
      freeShippingThresholdMinor: config.commerce.freeShippingThresholdMinor,
      reservationTtlMinutes: config.commerce.reservationTtlMinutes,
      maxQtyPerLine: config.commerce.maxQtyPerLine,
      upi: config.commerce.upi,
    },
  };
}
