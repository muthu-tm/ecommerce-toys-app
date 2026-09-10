import { z } from 'zod';

import { NotificationTypeSchema } from '@romp/contracts';

/**
 * Customer-visible copy.
 *
 * Nothing user-facing is a literal in a component. That is not stylistic tidiness: it
 * is what lets a second store adopt its own voice, and what makes the
 * `no-hardcoded-brand` lint rule enforceable — if copy lived in components, the rule
 * would have to allow string literals and would catch nothing.
 */

const CtaSchema = z.object({
  label: z.string().min(1).max(60),
  href: z.string().min(1),
});

export const HomeContentSchema = z.object({
  hero: z.object({
    eyebrow: z.string().min(1).max(80),
    headline: z.string().min(1).max(120),
    subcopy: z.string().min(1).max(300),
    primaryCta: CtaSchema,
    secondaryCta: CtaSchema,
  }),
  promo: z.object({
    headline: z.string().min(1).max(120),
    subcopy: z.string().min(1).max(300),
    cta: CtaSchema,
  }),
  trustBadges: z
    .array(
      z.object({
        title: z.string().min(1).max(60),
        description: z.string().min(1).max(160),
      }),
    )
    .min(1)
    .max(6),
  ageSectionTitle: z.string().min(1).max(120),
  featuredTitle: z.string().min(1).max(120),
  categorySectionTitle: z.string().min(1).max(120),
});

/**
 * The age taxonomy itself.
 *
 * A configured list, not a union in the code: a second store may sell to a different
 * age range, and baking `'3-5'` into a type would make the catalogue's shape a
 * property of the source rather than of the store.
 */
export const AgeBandConfigSchema = z.object({
  /** Stored on products and used in URLs — `/age/6-8`. */
  value: z.string().regex(/^[\w+-]+$/u, { error: 'An age band value looks like "3-5" or "8+".' }),
  label: z.string().min(1).max(40),
  note: z.string().min(1).max(120),
});
export type AgeBandConfig = z.infer<typeof AgeBandConfigSchema>;

export const AgeBandsSchema = z
  .array(AgeBandConfigSchema)
  .min(1)
  .refine((bands) => new Set(bands.map((band) => band.value)).size === bands.length, {
    error: 'Age band values must be unique — they appear in URLs.',
  });

/** Seed categories. Created by `pnpm seed`, then managed in admin. */
export const CategorySeedSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, { error: 'Must be a lowercase hyphenated slug.' }),
  /** Slug of the parent category, or absent for a top-level one. */
  parent: z.string().optional(),
  /**
   * Whether the category is live. Defaults to true — a seeded category is one the store means
   * to show. Deactivation is a backoffice action, not a seed-time state, but it is expressible
   * here so a store can ship a category it is still preparing.
   */
  active: z.boolean().default(true),
  showInFilters: z.boolean(),
  showInNav: z.boolean(),
  sortOrder: z.int().min(0).max(1_000),
});
export type CategorySeed = z.infer<typeof CategorySeedSchema>;

export const CategoriesSchema = z
  .array(CategorySeedSchema)
  .min(1)
  .refine(
    (categories) => new Set(categories.map((category) => category.slug)).size === categories.length,
    { error: 'Category slugs must be unique — they are URL identities.' },
  )
  .refine(
    (categories) => {
      const slugs = new Set(categories.map((category) => category.slug));
      return categories.every(
        (category) => category.parent === undefined || slugs.has(category.parent),
      );
    },
    { error: 'Every `parent` must be the slug of another category in this list.' },
  )
  .refine(
    (categories) => {
      // One level of nesting in practice. A deeper tree would need breadcrumb and
      // navigation work that v1.0 does not have, so it fails here rather than
      // rendering a category nobody can reach.
      const byParent = new Map(categories.map((category) => [category.slug, category.parent]));
      return categories.every((category) => {
        if (category.parent === undefined) return true;
        return byParent.get(category.parent) === undefined;
      });
    },
    { error: 'Categories nest one level only: a parent cannot itself have a parent.' },
  );

/**
 * Notification copy templates, one per notification kind.
 *
 * Keyed off `NotificationTypeSchema` in `@romp/contracts`, so adding a notification
 * kind there fails every store config until its copy exists. Better a failed build
 * than a customer receiving a blank notification.
 */
export const NotificationTemplateSchema = z.object({
  title: z.string().min(1).max(120),
  /** `{orderRef}`, `{amount}`, `{carrier}`, `{trackingNo}`, `{sku}` are interpolated. */
  body: z.string().min(1).max(300),
});

export const NotificationTemplatesSchema = z.object(
  Object.fromEntries(
    NotificationTypeSchema.options.map((type) => [type, NotificationTemplateSchema]),
  ) as Record<(typeof NotificationTypeSchema.options)[number], typeof NotificationTemplateSchema>,
);

/**
 * Product detail page copy.
 *
 * Every word the PDP renders that is not product data lives here, for the same reason
 * the rest of `content` does: a second store speaks in its own voice, and the
 * `no-hardcoded-brand` rule can only stay enforceable if no component carries a literal.
 *
 * The labels are deliberately generic — "In the box", "Add to bag" — because they
 * describe a commerce surface, not toys specifically. A store selling something other
 * than toys keeps the safety block (it can carry any compliance line) or leaves its
 * product safety flags false, in which case the notices never render.
 */
export const ProductContentSchema = z.object({
  /** The first breadcrumb, linking home. The rest are derived from the category and product. */
  breadcrumbHome: z.string().min(1).max(40),
  /** The add-to-cart button label. Wiring is Task 15; the affordance ships now. */
  addToCart: z.string().min(1).max(40),
  /** Shown in place of the button when nothing is in stock. */
  outOfStock: z.string().min(1).max(40),
  /** Prompt above the variant selector when more than one variant exists. */
  selectVariant: z.string().min(1).max(60),
  /** Heading for the "in the box" list. */
  inTheBoxTitle: z.string().min(1).max(60),
  /** Heading for the "skills it builds" tags. */
  skillsTitle: z.string().min(1).max(60),
  /** Heading for the safety block. */
  safetyTitle: z.string().min(1).max(60),
  /** Notice shown when a product declares a choking hazard. */
  smallPartsWarning: z.string().min(1).max(200),
  /** Prefix for a BIS certificate line, e.g. "BIS certified · " then the number. */
  bisCertifiedLabel: z.string().min(1).max(60),
  /** Shown when a product is BPA-free. */
  bpaFreeLabel: z.string().min(1).max(60),
  /** Suffix for the rating, e.g. "18 reviews". `{count}` is interpolated. */
  ratingCountLabel: z.string().min(1).max(60),
});
export type ProductContent = z.infer<typeof ProductContentSchema>;

export const EmptyStatesSchema = z.object({
  noResults: z.object({ title: z.string().min(1), body: z.string().min(1) }),
  emptyCart: z.object({ title: z.string().min(1), body: z.string().min(1) }),
  emptyWishlist: z.object({ title: z.string().min(1), body: z.string().min(1) }),
  emptyOrders: z.object({ title: z.string().min(1), body: z.string().min(1) }),
  emptyNotifications: z.object({ title: z.string().min(1), body: z.string().min(1) }),
});

export const FooterSchema = z.object({
  columns: z
    .array(
      z.object({
        title: z.string().min(1).max(60),
        links: z.array(CtaSchema).min(1),
      }),
    )
    .min(1)
    .max(4),
  legalLine: z.string().min(1).max(300),
});

export const PoliciesSchema = z.object({
  returns: z.string().min(1),
  shipping: z.string().min(1),
  privacy: z.string().min(1),
  terms: z.string().min(1),
});

export const ContentSchema = z.object({
  home: HomeContentSchema,
  product: ProductContentSchema,
  ageBands: AgeBandsSchema,
  categories: CategoriesSchema,
  footer: FooterSchema,
  policies: PoliciesSchema,
  notifications: NotificationTemplatesSchema,
  emptyStates: EmptyStatesSchema,
});
export type Content = z.infer<typeof ContentSchema>;

/**
 * Interpolates `{placeholder}` tokens in notification copy.
 *
 * An unknown placeholder is left in place rather than blanked, so a template typo is
 * visible in the notification instead of silently producing "Your order  has shipped".
 */
export function renderTemplate(
  template: string,
  values: Readonly<Record<string, string | undefined>>,
): string {
  return template.replaceAll(/\{(\w+)\}/gu, (match, key: string) => values[key] ?? match);
}
