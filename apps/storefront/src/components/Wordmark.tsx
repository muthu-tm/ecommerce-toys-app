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
/** Strips the leading `assets/` a config path carries, since these are served from `public/brand/`. */
const brandPath = (source: string): string => `/brand/${source.replace(/^assets\//u, '')}`;

export function Wordmark({ className, compact = false }: WordmarkProps) {
  // The compact mark is theme-agnostic (a square logo mark), so it needs no swap. The full
  // wordmark exists in a dark-surface and a light-surface variant — the dark one draws light
  // text, invisible on a light theme, and vice versa — so both are rendered and CSS shows the
  // one matching the active theme. `.theme-dark-only` / `.theme-light-only` (globals.css) key
  // off the same `data-theme` / `prefers-color-scheme` logic the token stylesheet uses, so the
  // logo can never mismatch the surface it sits on.
  return (
    <Link
      href="/"
      className={className}
      // The wordmark is the conventional "go home" control, and the visual is the name
      // itself, so the accessible name says where it goes.
      aria-label={`${brand.name} — home`}
    >
      {compact ? (
        <Image
          src={brandPath(brand.logos.mark)}
          alt={brand.name}
          width={36}
          height={36}
          priority
          className="h-9 w-auto"
        />
      ) : (
        <>
          <Image
            src={brandPath(brand.logos.dark)}
            alt={brand.name}
            width={132}
            height={36}
            priority
            className="theme-dark-only h-9 w-auto"
          />
          <Image
            src={brandPath(brand.logos.light)}
            alt={brand.name}
            width={132}
            height={36}
            priority
            className="theme-light-only h-9 w-auto"
          />
        </>
      )}
    </Link>
  );
}
