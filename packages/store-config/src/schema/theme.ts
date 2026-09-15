import { z } from 'zod';

import { isHexColor } from '../color';

/**
 * Theme schema.
 *
 * Every colour is a hex literal here and **nowhere else**. Components receive them as
 * CSS custom properties and Tailwind tokens, so neither a utility class nor an inline
 * style needs a literal — which is what makes the `no-hardcoded-brand` lint rule
 * enforceable rather than merely aspirational.
 */

const HexColorSchema = z
  .string()
  .refine(isHexColor, { error: 'Must be a hex colour such as "#d8fd4f".' })
  .transform((value) => value.toLowerCase());

export const ThemeColorsSchema = z.object({
  // Surfaces, darkest to lightest in ROMP's case — though nothing assumes a dark
  // theme. A light-theme store sets these to light values and the contrast gate
  // checks the same pairs.
  page: HexColorSchema,
  surface: HexColorSchema,
  surfaceAlt: HexColorSchema,
  surfaceDeep: HexColorSchema,
  /**
   * A raised surface, one step brighter (dark theme) or one step whiter (light theme)
   * than `surface`. For hero panels, promoted cards and dashboard stat tiles that want
   * more presence than the flat `surface`. Optional: when a config omits it, the emitter
   * falls back to `surface`, so every existing store keeps working unchanged.
   */
  surfaceElevated: HexColorSchema.optional(),

  primary: HexColorSchema,
  /** Text and icons drawn on top of `primary`. */
  primaryOn: HexColorSchema,
  accent: HexColorSchema,
  accentOn: HexColorSchema,

  textPrimary: HexColorSchema,
  textSecondary: HexColorSchema,
  /**
   * The lowest rung of the text ramp. Still gated at AA normal text: "muted" is a
   * visual intent, not permission to be unreadable.
   */
  textMuted: HexColorSchema,

  /**
   * Decorative divider. **Not** contrast-gated — see `contrast.ts` for why a border
   * between two dark surfaces cannot reach 3:1 and does not need to.
   */
  border: HexColorSchema,
  /** Interactive boundary — input outlines, selected states. Gated at 3:1. */
  borderStrong: HexColorSchema,
  /**
   * Focus indicator. Gated at 3:1 against every surface, because a focus ring that
   * cannot be seen makes the keyboard path unusable, and the purchase path must be
   * completable by keyboard alone.
   */
  focusRing: HexColorSchema,

  success: HexColorSchema,
  warning: HexColorSchema,
  danger: HexColorSchema,
});
export type ThemeColors = z.infer<typeof ThemeColorsSchema>;

/** A CSS length. Constrained so the emitted custom property cannot be arbitrary CSS. */
const CssLengthSchema = z.string().regex(/^\d+(?:\.\d+)?(?:px|rem|em|%)$|^0$/u, {
  error: 'Must be a CSS length such as "12px", "0.75rem" or "0".',
});

export const ThemeRadiiSchema = z.object({
  sm: CssLengthSchema,
  md: CssLengthSchema,
  lg: CssLengthSchema,
  /** Fully rounded. A large length rather than `50%`, which distorts on non-squares. */
  pill: CssLengthSchema,
});
export type ThemeRadii = z.infer<typeof ThemeRadiiSchema>;

export const ThemeShadowsSchema = z.object({
  card: z.string().min(1),
  overlay: z.string().min(1),
});

export const FontSourceSchema = z.enum(['google', 'local']);

export const FontSchema = z.object({
  /** Family name as `next/font` expects it, e.g. "Archivo Black". */
  family: z.string().min(1),
  /**
   * Weights to load. Each one is bytes on the critical path, so the list is explicit
   * rather than "all" — an unused weight is pure LCP cost.
   */
  weights: z.array(z.int().min(100).max(900).multipleOf(100)).min(1),
  source: FontSourceSchema,
  /** Fallback stack, used until the webfont loads and if it fails. */
  fallback: z.array(z.string().min(1)).min(1),
});
export type Font = z.infer<typeof FontSchema>;

export const ThemeFontsSchema = z.object({
  display: FontSchema,
  body: FontSchema,
});

/**
 * Global animation scale.
 *
 * Independent of `prefers-reduced-motion`, which **always wins** regardless of this
 * setting. This exists so a store can dial motion down as a brand choice; it is not
 * an accessibility control and must never be treated as one.
 */
export const MotionIntensitySchema = z.enum(['full', 'subtle', 'none']);
export type MotionIntensity = z.infer<typeof MotionIntensitySchema>;

export const ThemeMotionSchema = z.object({
  intensity: MotionIntensitySchema,
  /** Base transition duration in milliseconds; scaled by intensity when emitted. */
  durationMs: z.int().min(0).max(2_000),
  easing: z.string().min(1),
});

/**
 * Light and dark palettes for a store.
 *
 * A store may ship one palette or two. `theme.colors` is the **default** palette — the
 * one emitted into `:root` and used when JavaScript is off or a visitor has expressed no
 * preference. When `theme.modes` is present it names the same two palettes explicitly, so
 * the emitter can produce `[data-theme="light"]` and `[data-theme="dark"]` overrides and a
 * `prefers-color-scheme` fallback.
 *
 * Both palettes are contrast-gated independently: a store cannot ship a light theme that
 * fails WCAG AA any more than it can a dark one. Brand accents (the lime, the coral, the
 * display font) are shared across modes by convention, not by constraint — only the
 * surfaces and the text ramp typically differ.
 */
export const ThemeModesSchema = z.object({
  light: ThemeColorsSchema,
  dark: ThemeColorsSchema,
});
export type ThemeModes = z.infer<typeof ThemeModesSchema>;

/** Which palette a store treats as its baseline `:root`. */
export const DefaultThemeModeSchema = z.enum(['light', 'dark']);
export type DefaultThemeMode = z.infer<typeof DefaultThemeModeSchema>;

export const ThemeSchema = z.object({
  colors: ThemeColorsSchema,
  radii: ThemeRadiiSchema,
  shadows: ThemeShadowsSchema,
  fonts: ThemeFontsSchema,
  motion: ThemeMotionSchema,
  /**
   * Optional dual palette. When present, both `light` and `dark` are emitted as
   * `[data-theme]` overrides and the toggle can flip between them. When absent, the store
   * is single-theme and only `theme.colors` is emitted — every pre-existing config.
   */
  modes: ThemeModesSchema.optional(),
  /**
   * Which of the two modes `theme.colors` corresponds to, so the emitter knows which
   * palette a no-preference visitor sees by default. Defaults to `dark` (ROMP's original
   * baseline). Ignored when `modes` is absent.
   */
  defaultMode: DefaultThemeModeSchema.default('dark'),
});
export type Theme = z.infer<typeof ThemeSchema>;
