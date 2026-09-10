import { describe, expect, it } from 'vitest';

import type { Theme } from './schema/theme';
import {
  fontStack,
  googleFontExportName,
  renderFontsModule,
  renderTailwindThemeCss,
  themeCustomProperties,
} from './tokens';

const theme: Theme = {
  colors: {
    page: '#131417',
    surface: '#161719',
    surfaceAlt: '#191a1d',
    surfaceDeep: '#0e0e10',
    primary: '#d8fd4f',
    primaryOn: '#0e0e10',
    accent: '#ff6f5e',
    accentOn: '#3d0f08',
    textPrimary: '#f5f6f7',
    textSecondary: '#c2c6cf',
    textMuted: '#8b919d',
    border: '#2a2c31',
    borderStrong: '#6b727c',
    focusRing: '#d8fd4f',
    success: '#5ee9a0',
    warning: '#ffc857',
    danger: '#ff6b6b',
  },
  radii: { sm: '8px', md: '14px', lg: '22px', pill: '999px' },
  shadows: { card: '0 1px 2px rgb(0 0 0 / 0.4)', overlay: '0 24px 64px rgb(0 0 0 / 0.55)' },
  fonts: {
    display: {
      family: 'Archivo Black',
      weights: [400],
      source: 'google',
      fallback: ['ui-sans-serif', 'system-ui'],
    },
    body: {
      family: 'Archivo',
      weights: [400, 500, 700],
      source: 'google',
      fallback: ['sans-serif'],
    },
  },
  motion: { intensity: 'full', durationMs: 220, easing: 'ease-out' },
};

describe('fontStack', () => {
  it('quotes families containing spaces', () => {
    // An unquoted multi-word family is invalid CSS, and the browser silently falls
    // through to the next entry — which looks like a font that failed to load.
    expect(fontStack({ family: 'Archivo Black', fallback: ['sans-serif'] })).toBe(
      '"Archivo Black", sans-serif',
    );
  });

  it('leaves single-word families unquoted', () => {
    expect(fontStack({ family: 'Archivo', fallback: ['ui-sans-serif', 'system-ui'] })).toBe(
      'Archivo, ui-sans-serif, system-ui',
    );
  });

  it('keeps the configured order, family first', () => {
    expect(fontStack({ family: 'Inter', fallback: ['a', 'b', 'c'] })).toBe('Inter, a, b, c');
  });
});

describe('themeCustomProperties', () => {
  const properties = themeCustomProperties(theme);

  it('emits every colour as a prefixed custom property', () => {
    expect(properties['--store-color-page']).toBe('#131417');
    expect(properties['--store-color-primary']).toBe('#d8fd4f');
    expect(Object.keys(theme.colors).length).toBeGreaterThan(0);
    for (const name of Object.keys(theme.colors)) {
      const kebab = name.replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
      expect(properties[`--store-color-${kebab}`], name).toBeDefined();
    }
  });

  it('kebab-cases camelCase token names', () => {
    expect(properties['--store-color-text-primary']).toBe('#f5f6f7');
    expect(properties['--store-color-border-strong']).toBe('#6b727c');
    expect(properties['--store-color-focus-ring']).toBe('#d8fd4f');
  });

  it('emits radii, shadows and fonts', () => {
    expect(properties['--store-radius-pill']).toBe('999px');
    expect(properties['--store-shadow-card']).toContain('rgb(0 0 0 / 0.4)');
    // The next/font variable first, the literal family as its fallback, then the
    // configured stack — one declaration that is correct whether the webfont loaded,
    // the family is installed locally, or neither.
    expect(properties['--store-font-display']).toBe(
      'var(--font-store-display, "Archivo Black", ui-sans-serif, system-ui)',
    );
    expect(properties['--store-font-body']).toBe('var(--font-store-body, Archivo, sans-serif)');
  });

  it('emits motion at full intensity unscaled', () => {
    expect(properties['--store-motion-duration']).toBe('220ms');
    expect(properties['--store-motion-easing']).toBe('ease-out');
    expect(properties['--store-motion-intensity']).toBe('full');
  });

  it('scales duration for subtle intensity', () => {
    const subtle = themeCustomProperties({
      ...theme,
      motion: { ...theme.motion, intensity: 'subtle' },
    });

    expect(subtle['--store-motion-duration']).toBe('132ms');
  });

  it('collapses duration to zero for none', () => {
    const none = themeCustomProperties({
      ...theme,
      motion: { ...theme.motion, intensity: 'none' },
    });

    expect(none['--store-motion-duration']).toBe('0ms');
    expect(none['--store-motion-intensity']).toBe('none');
  });

  it('emits only lowercase hex, since the schema normalises case', () => {
    for (const [name, value] of Object.entries(properties)) {
      if (value.startsWith('#')) {
        expect(value, name).toBe(value.toLowerCase());
      }
    }
  });
});

describe('renderTailwindThemeCss', () => {
  const css = renderTailwindThemeCss(theme);

  it('emits an inline @theme block', () => {
    // `inline` makes utilities emit `var(--store-color-…)` rather than baking the
    // resolved value in at build time. Without it, switching stores would need a
    // Tailwind rebuild and the `:root` override would be ignored.
    expect(css.startsWith('@theme inline {')).toBe(true);
  });

  it('maps every colour onto Tailwind\u2019s --color-* namespace', () => {
    for (const name of Object.keys(theme.colors)) {
      const kebab = name.replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
      expect(css, name).toContain(`--color-${kebab}: var(--store-color-${kebab});`);
    }
  });

  it('maps radii, shadows, fonts and easing', () => {
    expect(css).toContain('--radius-pill: var(--store-radius-pill);');
    expect(css).toContain('--shadow-card: var(--store-shadow-card);');
    expect(css).toContain('--font-display: var(--store-font-display);');
    expect(css).toContain('--font-body: var(--store-font-body);');
    expect(css).toContain('--ease-theme: var(--store-motion-easing);');
  });

  it('contains no literal colour values', () => {
    // The whole point: one place a colour is written, and this is not it.
    expect(css).not.toContain('#');
  });

  it('is identical for two different palettes', () => {
    // The Tailwind surface must not vary per store — that is what makes a store switch
    // a data change rather than a code change.
    expect(
      renderTailwindThemeCss({ ...theme, colors: { ...theme.colors, primary: '#5b3df5' } }),
    ).toBe(css);
  });
});

describe('googleFontExportName', () => {
  it('maps a family name to next/font\u2019s export identifier', () => {
    expect(googleFontExportName('Archivo Black')).toBe('Archivo_Black');
    expect(googleFontExportName('Inter')).toBe('Inter');
    expect(googleFontExportName('  Noto Sans  ')).toBe('Noto_Sans');
  });
});

describe('renderFontsModule', () => {
  const config = { brand: { id: 'romp' }, theme } as never;
  const module = renderFontsModule(config);

  it('imports each configured family statically', () => {
    // next/font is statically analysed — there is no runtime API — which is exactly why
    // this module has to be generated rather than reading the config at request time.
    expect(module).toContain("import { Archivo_Black } from 'next/font/google';");
    expect(module).toContain("import { Archivo } from 'next/font/google';");
  });

  it('passes the theme variable so the stylesheet can reference it', () => {
    expect(module).toContain("variable: '--font-store-display'");
    expect(module).toContain("variable: '--font-store-body'");
  });

  it('requests only the configured weights', () => {
    // Each weight is bytes on the LCP path, so an unused one is pure cost.
    expect(module).toContain("weight: ['400']");
    expect(module).toContain("weight: ['400', '500', '700']");
  });

  it('uses display: swap', () => {
    // Invisible text while a webfont loads is a worse LCP than a font swap.
    expect(module).toContain("display: 'swap'");
  });

  it('exports a class name combining both variables', () => {
    expect(module).toContain('export const fontClassName =');
    expect(module).toContain('displayFont.variable');
    expect(module).toContain('bodyFont.variable');
  });

  it('does not import the same family twice', () => {
    const sameFamily = renderFontsModule({
      brand: { id: 'romp' },
      theme: {
        ...theme,
        fonts: { display: theme.fonts.body, body: theme.fonts.body },
      },
    } as never);

    expect(sameFamily.match(/from 'next\/font\/google'/gu)).toHaveLength(1);
  });

  it('explains rather than silently skipping a self-hosted face', () => {
    // Local faces need the licensed file names, which cannot be inferred.
    const local = renderFontsModule({
      brand: { id: 'romp' },
      theme: {
        ...theme,
        fonts: {
          display: { ...theme.fonts.display, source: 'local' },
          body: theme.fonts.body,
        },
      },
    } as never);

    expect(local).toContain("source: 'local'");
    expect(local).toContain('next/font/local');
  });
});
