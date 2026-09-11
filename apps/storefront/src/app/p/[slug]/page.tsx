import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ProductDetail } from '@/components/ProductDetail';
import { mediaUrl } from '@/lib/store';
import { productJsonLd } from '@/lib/structured-data';
import { getCategory, getProduct, getProductReviews } from '@/server/catalogue';

/**
 * The product detail page: `/p/{slug}`.
 *
 * Statically rendered per product and revalidated by tag — an edit to this product busts
 * `product:{slug}` (Task 12) without touching any other page. Like the listing pages, the
 * `[slug]` params vary, so this is an on-demand static page: the first request warms it
 * against the live catalogue, every later one is served from cache until the tag is busted
 * or the hour elapses.
 *
 * `generateStaticParams` is deliberately **not** implemented. Pre-rendering every product
 * at build would couple the build to a populated database (which CI does not have, per
 * Task 8's degradation design) and would not scale as the catalogue grows. On-demand ISR
 * gives the same cached-HTML result without either cost; the first visitor to a new
 * product pays a single render.
 */

export const revalidate = 3600;

interface ProductPageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

/** Absolute base for canonical and OG URLs — deployment config, like the root layout. */
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/u, '');

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await getProduct(slug);

  // A missing product still needs metadata; the page itself renders the 404. `noindex`
  // keeps a not-found URL out of the index rather than letting it be crawled as a real page.
  if (result === null) {
    return { title: 'Not found', robots: { index: false } };
  }

  const { product } = result;
  const canonical = `${siteUrl}/p/${product.slug}`;

  // The cover image (order 0), resolved to an absolute URL for the social card. Null when
  // no media host is configured, in which case the layout's OG fallback applies.
  const cover = [...product.media].sort((left, right) => left.order - right.order)[0] ?? null;
  const ogImage = cover !== null ? mediaUrl(cover.path) : null;

  // SEO title/description override the derived values when the admin set them; otherwise
  // the name and description carry the page. `index: false` on a product removes it from
  // search — an intentional per-product control, not a default.
  const title = product.seo.title ?? product.name;
  const description = product.seo.description ?? product.description;

  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: product.seo.index, follow: true },
    openGraph: {
      type: 'website',
      title,
      description,
      url: canonical,
      ...(ogImage !== null ? { images: [{ url: ogImage, alt: cover?.alt ?? product.name }] } : {}),
    },
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const result = await getProduct(slug);

  // 404 for a missing or unpublished product, so a retired or mistyped slug is a clean
  // not-found rather than a blank page that looks like a bug.
  if (result === null) notFound();

  const { product, variants } = result;

  // The category name for the breadcrumb. A null lookup (retired category) falls back to
  // the slug rather than blocking the page — the product still renders.
  const category = await getCategory(product.categorySlug);
  const categoryName = category?.name ?? product.categorySlug;

  const reviews = await getProductReviews(product.id, product.slug);

  const canonical = `${siteUrl}/p/${product.slug}`;
  const jsonLd = productJsonLd(product, variants, canonical);

  return (
    <>
      {/*
        Structured data for a rich result. Serialised here rather than in the lib so the
        lib returns an assertable object; `JSON.stringify` escapes the values, so this is
        not an injection surface for product copy.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <ProductDetail
        product={product}
        variants={variants}
        categoryName={categoryName}
        reviews={reviews}
      />
    </>
  );
}
