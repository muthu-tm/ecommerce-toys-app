import { Suspense } from 'react';

import { ButtonLink, Card, Reveal } from '@romp/ui';

import { FeaturedRail, NavCategoryRails } from '@/components/HomeRails';
import { ProductGridSkeleton } from '@/components/ProductGrid';
import { content } from '@/lib/store';

/**
 * The home page.
 *
 * Statically rendered and revalidated by tag: nothing here is per-request, so it is a
 * cached document that a catalogue write busts (see `revalidate` below and
 * `cacheTags.catalogue`). The hero, the age rail and the trust badges are config; the
 * product rails are live data.
 *
 * The rails are wrapped in `Suspense` so the static shell — hero, headings, age cards —
 * paints immediately and the data-dependent rails stream in behind a skeleton, rather
 * than the whole page waiting on Firestore.
 */

/**
 * Revalidate hourly as a floor, and on demand when the catalogue changes.
 *
 * The time-based floor is a backstop: even if a tag revalidation is somehow missed, the
 * page is never more than an hour stale. The real freshness comes from
 * `revalidateTag(cacheTags.catalogue)`, which Task 12's product-write path calls, so a
 * publish is reflected in seconds rather than at the next hourly boundary.
 */
export const revalidate = 3600;

const RAIL_SKELETON_COUNT = 6;

export default function HomePage() {
  const { hero, trustBadges, ageSectionTitle, featuredTitle } = content.home;

  return (
    <div className="flex flex-col gap-16">
      <section className="flex flex-col gap-4">
        <p className="font-body text-sm font-bold tracking-wide text-accent uppercase">
          {hero.eyebrow}
        </p>
        {/* The only h1 on the page. */}
        <h1 className="max-w-2xl font-display text-4xl leading-tight text-text-primary sm:text-5xl">
          {hero.headline}
        </h1>
        <p className="max-w-xl font-body text-lg text-text-secondary">{hero.subcopy}</p>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href={hero.primaryCta.href} size="lg">
            {hero.primaryCta.label}
          </ButtonLink>
          <ButtonLink href={hero.secondaryCta.href} size="lg" variant="outline">
            {hero.secondaryCta.label}
          </ButtonLink>
        </div>
      </section>

      <Suspense fallback={<ProductGridSkeleton count={RAIL_SKELETON_COUNT} />}>
        <FeaturedRail title={featuredTitle} />
      </Suspense>

      <section aria-labelledby="age-heading" className="flex flex-col gap-4">
        <h2 id="age-heading" className="font-display text-2xl text-text-primary">
          {ageSectionTitle}
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {content.ageBands.map((band, index) => (
            <Reveal as="li" key={band.value} delayMs={index * 60}>
              <Card interactive className="h-full">
                <a
                  href={`/age/${band.value}`}
                  className="flex h-full flex-col gap-1 p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  <span className="font-display text-xl text-text-primary">{band.label}</span>
                  <span className="font-body text-sm text-text-secondary">{band.note}</span>
                </a>
              </Card>
            </Reveal>
          ))}
        </ul>
      </section>

      <Suspense fallback={<ProductGridSkeleton count={RAIL_SKELETON_COUNT} />}>
        <NavCategoryRails />
      </Suspense>

      <section aria-labelledby="trust-heading" className="flex flex-col gap-4">
        <h2 id="trust-heading" className="sr-only">
          Why shop with us
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {trustBadges.map((badge) => (
            <li key={badge.title}>
              <Card className="h-full p-4">
                <p className="font-body font-bold text-text-primary">{badge.title}</p>
                <p className="mt-1 font-body text-sm text-text-secondary">{badge.description}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
