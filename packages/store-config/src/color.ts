/**
 * Colour maths, for the contrast gate.
 *
 * This exists so a rebrand cannot ship a palette nobody can read. A white-label
 * platform hands palette choices to whoever configures the next store — often
 * someone choosing colours that look good on their own monitor — and without a gate
 * the accessibility problem lands on the least-equipped person to notice it.
 *
 * Implements the WCAG 2.x relative-luminance and contrast-ratio definitions. No
 * dependency: it is about twenty lines of arithmetic, and a colour library would be
 * a supply-chain surface for the sake of them.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** `#rgb`, `#rrggbb` or `#rrggbbaa`. Alpha is parsed but ignored for contrast. */
const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/iu;

export function isHexColor(value: string): boolean {
  return HEX_PATTERN.test(value);
}

/**
 * Parses a hex colour to 8-bit channels.
 *
 * Throws rather than returning null: every caller here has already validated the
 * string through the schema, so a failure is a programming error and should be loud.
 */
export function parseHexColor(value: string): Rgb {
  if (!isHexColor(value)) {
    throw new TypeError(`Not a hex colour: ${JSON.stringify(value)}`);
  }

  const hex = value.slice(1);
  const expanded =
    hex.length === 3
      ? // Doubling each digit expands #abc to #aabbcc. A regex replace rather than a
        // spread because the input is ASCII hex by construction and spreading a string
        // invites the code-unit pitfalls the lint rule warns about.
        hex.replaceAll(/./gu, (digit) => digit + digit)
      : hex.slice(0, 6); // Drop alpha; contrast is computed against opaque surfaces.

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

/**
 * WCAG relative luminance.
 *
 * The 0.04045 threshold is what tooling has standardised on. WCAG 2.x prose says
 * 0.03928; the two disagree only for 8-bit channel values 10 and 11, which cannot
 * change a pass/fail verdict at the ratios we gate on.
 */
export function relativeLuminance(color: Rgb): number {
  const linearise = (channel: number): number => {
    const scaled = channel / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * linearise(color.r) + 0.7152 * linearise(color.g) + 0.0722 * linearise(color.b);
}

/**
 * Contrast ratio between two colours, from 1 (identical) to 21 (black on white).
 *
 * Order-independent, which is why callers do not have to know which of the pair is
 * lighter.
 */
export function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(parseHexColor(foreground));
  const second = relativeLuminance(parseHexColor(background));
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);

  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG conformance thresholds. */
export const CONTRAST_THRESHOLDS = Object.freeze({
  /** Normal-size body text. */
  aaNormal: 4.5,
  /** Text at 18.66px bold or 24px regular and above. */
  aaLarge: 3,
  /** Borders, icons and other non-text visual boundaries. */
  aaNonText: 3,
  aaaNormal: 7,
});

export type ContrastRequirement = keyof typeof CONTRAST_THRESHOLDS;

export function meetsContrast(
  foreground: string,
  background: string,
  requirement: ContrastRequirement = 'aaNormal',
): boolean {
  return contrastRatio(foreground, background) >= CONTRAST_THRESHOLDS[requirement];
}

/** Rounds to two decimals, for readable failure messages. */
export function formatContrastRatio(ratio: number): string {
  return `${(Math.round(ratio * 100) / 100).toFixed(2)}:1`;
}
