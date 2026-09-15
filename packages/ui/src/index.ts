/**
 * `@romp/ui` — the design system.
 *
 * Every colour, radius, font and duration is a token emitted from store config. There is
 * no literal in this package, which is what lets a second store restyle the whole
 * storefront without touching a component.
 *
 * The accessibility work is concentrated here on purpose. Getting `htmlFor`/`id` wiring,
 * accessible names on icon buttons, focus-visible rings and a modal's focus trap right is
 * mechanical, and mechanical work belongs in one place where it can be tested once —
 * rather than at every call site, where it will eventually be forgotten.
 */

export { cn } from './cn';
export type { ClassValue } from './cn';

export { FOCUS_RING, TABBABLE_SELECTOR, tabbableElements } from './focus';

export { TRANSITION, Reveal, useReducedMotion } from './motion';
export type { RevealProps } from './motion';

export { Button, ButtonLink } from './Button';
export type { ButtonLinkProps, ButtonProps, ButtonSize, ButtonVariant } from './Button';

export { IconButton } from './IconButton';
export type { IconButtonProps } from './IconButton';

export { Spinner } from './Spinner';
export type { SpinnerProps } from './Spinner';

export { Field, VisuallyHidden } from './Field';
export type { FieldProps, VisuallyHiddenProps } from './Field';

export { Dialog } from './Dialog';
export type { DialogProps } from './Dialog';

export { Badge, Card, Skeleton, SkipLink } from './Surface';
export type { BadgeProps, BadgeTone, CardProps, SkeletonProps, SkipLinkProps } from './Surface';

export { PageHeader, Section, Stack } from './Layout';
export type { PageHeaderProps, SectionProps, StackGap, StackProps } from './Layout';

export { Stat } from './Stat';
export type { StatProps, StatTone } from './Stat';

export { InitialTile } from './InitialTile';
export type { InitialTileProps, InitialTileSize } from './InitialTile';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';

export {
  THEME_STORAGE_KEY,
  ThemeProvider,
  ThemeToggle,
  themeInitScript,
  useThemeMode,
} from './theme-mode';
export type { ThemeMode, ThemeProviderProps, ThemeToggleProps } from './theme-mode';
