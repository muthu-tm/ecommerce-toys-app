import { Suspense } from 'react';

import { ButtonLink, Card, Reveal, Section } from '@romp/ui';

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
  const { hero, promo, trustBadges, ageSectionTitle, featuredTitle } = content.home;

  return (
    <div className="flex flex-col gap-16">
      {/*
        The hero sits on an elevated, gradient-lit panel rather than the flat page, so it
        reads as the front door rather than the first paragraph. The glow is drawn with
        token colours at low opacity — no literals — and is decorative, so it is aria-hidden.
      */}
      <section className="relative overflow-hidden rounded-lg border border-border bg-surface-elevated px-6 py-12 shadow-card sm:px-10 sm:py-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-pill bg-primary/15 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -left-16 size-72 rounded-pill bg-accent/10 blur-3xl"
        />
        <div className="relative flex max-w-2xl flex-col gap-4">
          <p className="font-body text-sm font-bold tracking-wide text-accent uppercase">
            {hero.eyebrow}
          </p>
          {/* The only h1 on the page. */}
          <h1 className="font-display text-4xl leading-tight text-text-primary sm:text-6xl">
            {hero.headline}
          </h1>
          <p className="max-w-xl font-body text-lg text-text-secondary">{hero.subcopy}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <ButtonLink href={hero.primaryCta.href} size="lg">
              {hero.primaryCta.label}
            </ButtonLink>
            <ButtonLink href={hero.secondaryCta.href} size="lg" variant="outline">
              {hero.secondaryCta.label}
            </ButtonLink>
          </div>
        </div>
      </section>

      <Suspense fallback={<ProductGridSkeleton count={RAIL_SKELETON_COUNT} />}>
        <FeaturedRail title={featuredTitle} />
      </Suspense>

      <Section id="shop-by-age" title={ageSectionTitle} className="scroll-mt-20">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {content.ageBands.map((band, index) => (
            <Reveal as="li" key={band.value} delayMs={index * 60}>
              <Card interactive className="h-full">
                <a
                  href={`/age/${band.value}`}
                  className="flex h-full flex-col gap-1 p-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  {/* A quiet ordinal so the band grid reads as a progression, not four equal boxes. */}
                  <span aria-hidden="true" className="font-display text-sm text-accent">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="font-display text-xl text-text-primary">{band.label}</span>
                  <span className="font-body text-sm text-text-secondary">{band.note}</span>
                </a>
              </Card>
            </Reveal>
          ))}
        </ul>
      </Section>

      {/* A single promotional band, config-driven, to break the rhythm between rails. */}
      <Reveal>
        <Card className="flex flex-col gap-4 bg-surface-elevated p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div className="flex flex-col gap-1">
            <p className="font-display text-2xl text-text-primary">{promo.headline}</p>
            <p className="font-body text-text-secondary">{promo.subcopy}</p>
          </div>
          <ButtonLink href={promo.cta.href} variant="accent" className="shrink-0">
            {promo.cta.label}
          </ButtonLink>
        </Card>
      </Reveal>

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
              <Card className="flex h-full flex-col gap-2 p-5">
                {/* A small accent tick keeps the trust row from being four grey paragraphs. */}
                <span
                  aria-hidden="true"
                  className="inline-flex size-8 items-center justify-center rounded-pill bg-primary/15 text-accent"
                >
                  <svg viewBox="0 0 20 20" className="size-4" fill="none">
                    <path
                      d="M4 10.5l4 4 8-9"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <p className="font-body font-bold text-text-primary">{badge.title}</p>
                <p className="font-body text-sm text-text-secondary">{badge.description}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
