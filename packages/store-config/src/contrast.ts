import { CONTRAST_THRESHOLDS, contrastRatio, formatContrastRatio } from './color';
import type { ContrastRequirement } from './color';
import type { ThemeColors } from './schema/theme';

/**
 * The contrast gate.
 *
 * A white-label platform hands palette choices to whoever configures the next store.
 * Without a gate, the accessibility problem lands on the least-equipped person to
 * notice it — so a config that fails WCAG AA cannot ship.
 *
 * What is checked, and what deliberately is not:
 *
 * - **Text on every surface** at AA normal (4.5:1). Including `textMuted`: "muted" is
 *   a visual intent, not permission to be unreadable.
 * - **`primaryOn` on `primary`** and `accentOn` on `accent`, because those are button
 *   labels — the most important text on the page.
 * - **`primary` and `accent` as text on surfaces**, since prices and links use them.
 * - **`borderStrong` and `focusRing`** at the 3:1 non-text bar. A focus ring that
 *   cannot be seen makes the keyboard purchase path unusable.
 * - **Status colours** on surfaces, at AA normal — a danger message nobody can read is
 *   worse than no message.
 *
 * `border` is **not** checked. It is a decorative divider between two surfaces of
 * similar lightness, and WCAG's 3:1 non-text requirement covers components and state
 * indicators that carry meaning, not ornamental rules. Gating it would force every
 * dark theme to draw hairlines in mid-grey, which is a worse design outcome for no
 * accessibility gain. `borderStrong` carries the interactive cases and is gated.
 */

export interface ContrastPair {
  readonly label: string;
  readonly foreground: keyof ThemeColors;
  readonly background: keyof ThemeColors;
  readonly requirement: ContrastRequirement;
}

const SURFACES: readonly (keyof ThemeColors)[] = Object.freeze([
  'page',
  'surface',
  'surfaceAlt',
  'surfaceDeep',
]);

const TEXT_ON_SURFACE: readonly (keyof ThemeColors)[] = Object.freeze([
  'textPrimary',
  'textSecondary',
  'textMuted',
]);

const BRAND_AS_TEXT: readonly (keyof ThemeColors)[] = Object.freeze(['primary', 'accent']);

const STATUS: readonly (keyof ThemeColors)[] = Object.freeze(['success', 'warning', 'danger']);

const NON_TEXT_ON_SURFACE: readonly (keyof ThemeColors)[] = Object.freeze([
  'borderStrong',
  'focusRing',
]);

/** Every pair the gate enforces, derived so a new surface is covered automatically. */
export function contrastPairs(): readonly ContrastPair[] {
  const pairs: ContrastPair[] = [];

  for (const background of SURFACES) {
    for (const foreground of [...TEXT_ON_SURFACE, ...BRAND_AS_TEXT, ...STATUS]) {
      pairs.push({
        label: `${foreground} on ${background}`,
        foreground,
        background,
        requirement: 'aaNormal',
      });
    }
    for (const foreground of NON_TEXT_ON_SURFACE) {
      pairs.push({
        label: `${foreground} on ${background}`,
        foreground,
        background,
        requirement: 'aaNonText',
      });
    }
  }

  pairs.push(
    {
      label: 'primaryOn on primary (button label)',
      foreground: 'primaryOn',
      background: 'primary',
      requirement: 'aaNormal',
    },
    {
      label: 'accentOn on accent (button label)',
      foreground: 'accentOn',
      background: 'accent',
      requirement: 'aaNormal',
    },
  );

  return pairs;
}

export interface ContrastFailure {
  readonly label: string;
  readonly ratio: number;
  readonly required: number;
  readonly foreground: string;
  readonly background: string;
}

/** Every pair that fails, so a config author fixes all of them in one pass. */
export function findContrastFailures(colors: ThemeColors): readonly ContrastFailure[] {
  const failures: ContrastFailure[] = [];

  for (const pair of contrastPairs()) {
    const foreground = colors[pair.foreground];
    const background = colors[pair.background];
    const ratio = contrastRatio(foreground, background);
    const required = CONTRAST_THRESHOLDS[pair.requirement];

    if (ratio < required) {
      failures.push({ label: pair.label, ratio, required, foreground, background });
    }
  }

  return failures;
}

/** Renders failures as a message an author can act on without opening a contrast tool. */
export function formatContrastFailures(failures: readonly ContrastFailure[]): string {
  return failures
    .map(
      (failure) =>
        `  ${failure.label}: ${formatContrastRatio(failure.ratio)} (needs ${String(failure.required)}:1) — ${failure.foreground} on ${failure.background}`,
    )
    .join('\n');
}

export class ContrastError extends Error {
  readonly failures: readonly ContrastFailure[];

  constructor(storeId: string, failures: readonly ContrastFailure[]) {
    super(
      `Store "${storeId}" has ${String(failures.length)} colour pair${failures.length === 1 ? '' : 's'} below WCAG AA:\n${formatContrastFailures(failures)}\n\nAdjust theme.colors so every pair passes. Contrast is a release gate, not a warning.`,
    );
    this.name = 'ContrastError';
    this.failures = failures;
  }
}

/** Throws unless every gated pair passes. */
export function assertContrast(storeId: string, colors: ThemeColors): void {
  const failures = findContrastFailures(colors);
  if (failures.length > 0) {
    throw new ContrastError(storeId, failures);
  }
}
