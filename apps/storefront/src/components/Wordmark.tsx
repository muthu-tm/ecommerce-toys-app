import Image from 'next/image';
import Link from 'next/link';

import { brand } from '@/lib/store';

export interface WordmarkProps {
  readonly className?: string;
  /** Use the square mark instead of the full wordmark. For narrow viewports. */
  readonly compact?: boolean;
}

/**
 * The store's wordmark, linking home.
 *
 * Everything here comes from `brand` in store config: the artwork path, the alt text and
 * the accessible name. A second store swaps the SVG files and its own name appears.
 *
 * The `alt` is the store name rather than "logo": a screen reader already announces the
 * role, so "ROMP logo, link" is redundant where "ROMP, link" is what a sighted user sees.
 */
export function Wordmark({ className, compact = false }: WordmarkProps) {
  const source = compact ? brand.logos.mark : brand.logos.dark;

  return (
    <Link
      href="/"
      className={className}
      // The wordmark is the conventional "go home" control, and the visual is the name
      // itself, so the accessible name says where it goes.
      aria-label={`${brand.name} — home`}
    >
      <Image
        src={`/brand/${source.replace(/^assets\//u, '')}`}
        alt={brand.name}
        width={compact ? 36 : 132}
        height={36}
        // The wordmark is above the fold on every page, so it must not be lazy.
        priority
        className="h-9 w-auto"
      />
    </Link>
  );
}
