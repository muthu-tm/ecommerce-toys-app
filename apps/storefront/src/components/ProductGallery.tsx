'use client';

import Image from 'next/image';
import { useState } from 'react';

import { InitialTile, cn } from '@romp/ui';

/**
 * The product image gallery.
 *
 * A client island because selecting a thumbnail swaps the main image, which is state. It
 * is small and self-contained: the server resolves every media path to a URL and passes
 * the list in, so this component holds no knowledge of Storage or the media base — only
 * which image is currently shown.
 *
 * Layout-shift-free by construction: the main frame is a fixed square that reserves its
 * space before any image loads, the same discipline the listing cards use. The cover is
 * `priority` because on a PDP it is the LCP element; the rest are lazy.
 *
 * Accessible as a set of controls: each thumbnail is a real button with the image's alt
 * text as its accessible name, and the selected one carries `aria-current`. A product
 * with a single image renders just the frame, with no thumbnail row to tab through.
 */
export interface GalleryImage {
  readonly url: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
  readonly blurhash: string | null;
}

export interface ProductGalleryProps {
  readonly images: readonly GalleryImage[];
  /** The product name, for the placeholder shown when there is no photography yet. */
  readonly productName: string;
}

/** How wide the main image renders, so the browser fetches the right resolution. */
const MAIN_SIZES = '(min-width: 1024px) 40vw, 100vw';

export function ProductGallery({ images, productName }: ProductGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = images[activeIndex] ?? images[0] ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-surface-alt">
        {active === null ? (
          // No photography yet — the honest state of a freshly seeded store. A large,
          // calm placeholder rather than a broken image.
          <InitialTile name={productName} size="xl" />
        ) : (
          <Image
            key={active.url}
            src={active.url}
            alt={active.alt}
            fill
            sizes={MAIN_SIZES}
            priority
            className="object-cover"
            {...(active.blurhash != null
              ? { placeholder: 'blur' as const, blurDataURL: active.blurhash }
              : {})}
          />
        )}
      </div>

      {images.length > 1 && (
        <ul className="flex flex-wrap gap-2">
          {images.map((image, index) => (
            <li key={image.url}>
              <button
                type="button"
                onClick={() => {
                  setActiveIndex(index);
                }}
                aria-current={index === activeIndex ? 'true' : undefined}
                className={cn(
                  'relative aspect-square w-16 overflow-hidden rounded-md bg-surface-alt',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
                  index === activeIndex
                    ? 'ring-2 ring-border-strong'
                    : 'ring-1 ring-border opacity-80 hover:opacity-100',
                )}
              >
                <Image src={image.url} alt={image.alt} fill sizes="64px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
