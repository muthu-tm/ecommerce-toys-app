import type { ReactNode } from 'react';

import { cn } from './cn';

export type InitialTileSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE: Readonly<Record<InitialTileSize, string>> = Object.freeze({
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'text-4xl',
  xl: 'text-6xl',
});

export interface InitialTileProps {
  /** The name the tile stands in for. Its first character is shown. */
  readonly name: string;
  readonly size?: InitialTileSize;
  readonly className?: string;
  /** Optional overlay (a badge, a "processing" note) rendered above the initial. */
  readonly children?: ReactNode;
}

/**
 * The photography placeholder.
 *
 * A freshly seeded store has no product images, and a store before its media host is
 * configured resolves every media path to null. Rather than a broken image or empty box,
 * a card shows a calm tile with the product's initial — visibly a placeholder, not a
 * failure. Extracted into the design system so the storefront card, the PDP gallery, the
 * cart line and the admin product list all render the same placeholder instead of each
 * re-implementing it slightly differently.
 *
 * `aria-hidden` because the initial carries no information a screen reader needs — the
 * product name is already in the surrounding markup. It fills its container, so the caller
 * owns the aspect ratio.
 */
export function InitialTile({ name, size = 'md', className, children }: InitialTileProps) {
  return (
    <span
      className={cn(
        'flex h-full w-full items-center justify-center bg-surface-alt font-display text-text-muted',
        SIZE[size],
        className,
      )}
    >
      <span aria-hidden="true">{name.slice(0, 1)}</span>
      {children}
    </span>
  );
}
