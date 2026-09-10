import { describe, expect, it } from 'vitest';

import {
  ContrastError,
  assertContrast,
  contrastPairs,
  findContrastFailures,
  formatContrastFailures,
} from './contrast';
import type { ThemeColors } from './schema/theme';

/** A palette that passes, as the baseline for mutation. */
const PASSING: ThemeColors = {
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
};

describe('contrastPairs', () => {
  it('covers every text colour against every surface', () => {
    const pairs = contrastPairs();

    for (const surface of ['page', 'surface', 'surfaceAlt', 'surfaceDeep']) {
      for (const text of ['textPrimary', 'textSecondary', 'textMuted']) {
        expect(
          pairs.some((pair) => pair.foreground === text && pair.background === surface),
          `${text} on ${surface} is not gated`,
        ).toBe(true);
      }
    }
  });

  it('gates button labels against their own background', () => {
    const pairs = contrastPairs();

    expect(
      pairs.some((pair) => pair.foreground === 'primaryOn' && pair.background === 'primary'),
    ).toBe(true);
    expect(
      pairs.some((pair) => pair.foreground === 'accentOn' && pair.background === 'accent'),
    ).toBe(true);
  });

  it('gates the focus ring, at the non-text bar', () => {
    // A focus ring nobody can see makes the keyboard purchase path unusable.
    const focus = contrastPairs().filter((pair) => pair.foreground === 'focusRing');

    expect(focus.length).toBe(4);
    for (const pair of focus) expect(pair.requirement).toBe('aaNonText');
  });

  it('holds muted text to the same bar as body text', () => {
    // "Muted" is a visual intent, not permission to be unreadable.
    const muted = contrastPairs().filter((pair) => pair.foreground === 'textMuted');

    expect(muted.length).toBeGreaterThan(0);
    for (const pair of muted) expect(pair.requirement).toBe('aaNormal');
  });

  it('does not gate the decorative border', () => {
    // A hairline between two surfaces of similar lightness cannot reach 3:1, and
    // WCAG's non-text rule covers meaningful components, not ornament. borderStrong
    // carries the interactive cases and is gated.
    const pairs = contrastPairs();

    expect(pairs.some((pair) => pair.foreground === 'border')).toBe(false);
    expect(pairs.some((pair) => pair.foreground === 'borderStrong')).toBe(true);
  });
});

describe('findContrastFailures', () => {
  it('finds nothing wrong with a passing palette', () => {
    expect(findContrastFailures(PASSING)).toEqual([]);
  });

  it('catches unreadable body text', () => {
    const failures = findContrastFailures({ ...PASSING, textPrimary: '#2b2d33' });

    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]?.label).toContain('textPrimary');
    expect(failures[0]?.ratio).toBeLessThan(4.5);
  });

  it('catches a button label nobody can read', () => {
    // The most consequential text on the page.
    const failures = findContrastFailures({ ...PASSING, primaryOn: '#e9ffa0' });

    expect(failures.some((failure) => failure.label.includes('primaryOn'))).toBe(true);
  });

  it('catches an invisible focus ring', () => {
    const failures = findContrastFailures({ ...PASSING, focusRing: '#1a1b1f' });

    expect(failures.some((failure) => failure.label.includes('focusRing'))).toBe(true);
  });

  it('reports every failing pair, not just the first', () => {
    // So an author fixes all of them in one pass instead of one build at a time.
    const failures = findContrastFailures({
      ...PASSING,
      textPrimary: '#1e2024',
      textSecondary: '#20222a',
    });

    expect(failures.length).toBeGreaterThan(2);
    expect(failures.some((failure) => failure.label.includes('textPrimary'))).toBe(true);
    expect(failures.some((failure) => failure.label.includes('textSecondary'))).toBe(true);
  });

  it('accepts a light palette as readily as a dark one', () => {
    // The gate must not be tuned to a dark theme, or a light-theme store would be
    // unable to configure a valid palette.
    expect(
      findContrastFailures({
        page: '#ffffff',
        surface: '#f7f8fa',
        surfaceAlt: '#eef0f4',
        surfaceDeep: '#e8eaef',
        primary: '#5b3df5',
        primaryOn: '#ffffff',
        accent: '#b91c1c',
        accentOn: '#ffffff',
        textPrimary: '#101114',
        textSecondary: '#3f434c',
        textMuted: '#5a6070',
        border: '#dfe3ea',
        borderStrong: '#7c8290',
        focusRing: '#5b3df5',
        success: '#0f766e',
        warning: '#7f5307',
        danger: '#b3261e',
      }),
    ).toEqual([]);
  });
});

describe('assertContrast', () => {
  it('passes a valid palette silently', () => {
    expect(() => {
      assertContrast('romp', PASSING);
    }).not.toThrow();
  });

  it('throws ContrastError naming the store and every failure', () => {
    let thrown: unknown;
    try {
      assertContrast('toybox', { ...PASSING, textMuted: '#3a3d44' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ContrastError);
    const error = thrown as ContrastError;
    expect(error.message).toContain('toybox');
    expect(error.message).toContain('textMuted');
    expect(error.failures.length).toBeGreaterThan(0);
    // It must be clear this is a gate, not advice.
    expect(error.message).toMatch(/release gate/);
  });
});

describe('formatContrastFailures', () => {
  it('renders the ratio, the requirement and both colours', () => {
    const message = formatContrastFailures(
      findContrastFailures({ ...PASSING, textPrimary: '#26282e' }),
    );

    // Enough for an author to act without opening a contrast tool.
    expect(message).toMatch(/textPrimary on \w+: \d+\.\d{2}:1 \(needs 4\.5:1\)/);
    expect(message).toContain('#26282e');
  });

  it('renders nothing for no failures', () => {
    expect(formatContrastFailures([])).toBe('');
  });
});
