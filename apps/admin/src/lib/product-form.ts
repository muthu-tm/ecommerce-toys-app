import type {
  CreateProductRequest,
  CreateVariantRequest,
  ProductStatus,
  UpdateProductRequest,
} from '@romp/contracts';

/**
 * The backoffice product form's state and its mapping to the API request.
 *
 * The form holds strings — that is what inputs produce — and this module turns that state
 * into the typed request the API validates, and back. Keeping the mapping pure means the
 * fiddly parts (splitting comma lists, parsing rupee prices to paise, the safety block's
 * conditional fields) are unit-tested without rendering anything, and the form component
 * stays a thin binding over it.
 */

export interface ProductFormState {
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly brand: string;
  readonly categoryId: string;
  readonly categorySlug: string;
  readonly ageBand: string;
  readonly badge: string;
  /** Comma-separated in the form; split into an array for the request. */
  readonly skills: string;
  readonly boxItems: string;
  readonly bisCertified: boolean;
  readonly bisCertNo: string;
  readonly bisCertExpiry: string;
  readonly bpaFree: boolean;
  readonly hasSmallParts: boolean;
  // SEO tab.
  readonly seoTitle: string;
  readonly seoDescription: string;
  readonly seoIndex: boolean;
}

/** A blank form, for the create page. */
export const EMPTY_PRODUCT_FORM: ProductFormState = {
  name: '',
  slug: '',
  description: '',
  brand: '',
  categoryId: '',
  categorySlug: '',
  ageBand: '',
  badge: '',
  skills: '',
  boxItems: '',
  bisCertified: false,
  bisCertNo: '',
  bisCertExpiry: '',
  bpaFree: false,
  hasSmallParts: false,
  seoTitle: '',
  seoDescription: '',
  seoIndex: true,
};

/** Splits a comma-or-newline separated field into trimmed, non-empty entries. */
export function splitList(value: string): string[] {
  return value
    .split(/[,\n]/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** A form value that is empty becomes null; otherwise the trimmed string. */
function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** The safety block, shared by create and update, with the conditional cert fields. */
function safetyFromForm(state: ProductFormState) {
  return {
    bisCertified: state.bisCertified,
    // A certificate number and expiry only make sense when certified; otherwise null, which
    // the schema requires when `bisCertified` is false's counterpart is not asserted but the
    // form should not send stale values.
    bisCertNo: state.bisCertified ? nullableText(state.bisCertNo) : null,
    bisCertExpiry: state.bisCertified ? nullableText(state.bisCertExpiry) : null,
    bpaFree: state.bpaFree,
    hasSmallParts: state.hasSmallParts,
  };
}

/** The SEO block, shared by create and update. */
function seoFromForm(state: ProductFormState) {
  return {
    title: nullableText(state.seoTitle),
    description: nullableText(state.seoDescription),
    index: state.seoIndex,
  };
}

/**
 * Maps the form to a create request.
 *
 * The slug is omitted when blank, so the server derives it from the name — the form's live
 * preview and the server's fallback both use `@romp/core`'s `deriveSlug`, so they agree.
 */
export function toCreateRequest(state: ProductFormState): CreateProductRequest {
  return {
    name: state.name.trim(),
    ...(state.slug.trim().length > 0 ? { slug: state.slug.trim() as CreateProductRequest['slug'] } : {}),
    description: state.description.trim(),
    brand: state.brand.trim(),
    categoryId: state.categoryId,
    categorySlug: state.categorySlug as CreateProductRequest['categorySlug'],
    ageBand: state.ageBand as CreateProductRequest['ageBand'],
    badge: nullableText(state.badge),
    skills: splitList(state.skills),
    boxItems: splitList(state.boxItems),
    safety: safetyFromForm(state),
    seo: seoFromForm(state),
  };
}

/** Maps the form to an update request (no slug — a rename is a separate action). */
export function toUpdateRequest(state: ProductFormState): UpdateProductRequest {
  return {
    name: state.name.trim(),
    description: state.description.trim(),
    brand: state.brand.trim(),
    categoryId: state.categoryId,
    categorySlug: state.categorySlug as UpdateProductRequest['categorySlug'],
    ageBand: state.ageBand as UpdateProductRequest['ageBand'],
    badge: nullableText(state.badge),
    skills: splitList(state.skills),
    boxItems: splitList(state.boxItems),
    safety: safetyFromForm(state),
    seo: seoFromForm(state),
  };
}

export interface VariantFormState {
  readonly name: string;
  readonly sku: string;
  /** Rupees, as typed; converted to paise for the request. */
  readonly price: string;
  readonly mrp: string;
  readonly weightGrams: string;
  readonly active: boolean;
}

/** Parses a rupee string to integer paise, or null if it is not a valid amount. */
export function rupeesToPaise(value: string): number | null {
  const rupees = Number(value.trim());
  if (!Number.isFinite(rupees) || rupees < 0) return null;
  return Math.round(rupees * 100);
}

export type VariantMapResult =
  | { readonly ok: true; readonly request: CreateVariantRequest }
  | { readonly ok: false; readonly field: 'price' | 'mrp' | 'weightGrams' };

/**
 * Maps the variant sub-form to a create/update request, or reports the first invalid field.
 *
 * Prices are entered in rupees and converted to paise here — the one place the rupee→paise
 * conversion happens on the way in, so a price is never stored as a float. A non-numeric
 * price is reported as a field error rather than sent as `NaN`.
 */
export function toVariantRequest(state: VariantFormState): VariantMapResult {
  const priceMinor = rupeesToPaise(state.price);
  if (priceMinor === null) return { ok: false, field: 'price' };
  const mrpMinor = rupeesToPaise(state.mrp);
  if (mrpMinor === null) return { ok: false, field: 'mrp' };
  const weightGrams = Number(state.weightGrams.trim());
  if (!Number.isInteger(weightGrams) || weightGrams <= 0) {
    return { ok: false, field: 'weightGrams' };
  }

  return {
    ok: true,
    request: {
      name: state.name.trim(),
      sku: state.sku.trim() as CreateVariantRequest['sku'],
      priceMinor: priceMinor as CreateVariantRequest['priceMinor'],
      mrpMinor: mrpMinor as CreateVariantRequest['mrpMinor'],
      options: {},
      active: state.active,
      weightGrams,
    },
  };
}

/**
 * Maps a stored product to the edit form's state.
 *
 * The inverse of `toUpdateRequest` for the fields the form owns: it joins the list fields
 * back to comma-separated text, formats the BIS expiry `Date` to the `YYYY-MM-DD` a date
 * input wants, and surfaces the SEO overrides. The denormalised and computed fields
 * (variant summary, prices, search tokens) are not form state — they are shown elsewhere.
 */
export function productDocToFormState(product: {
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly brand: string;
  readonly categoryId: string;
  readonly categorySlug: string;
  readonly ageBand: string;
  readonly badge: string | null;
  readonly skills: readonly string[];
  readonly boxItems: readonly string[];
  readonly safety: {
    readonly bisCertified: boolean;
    readonly bisCertNo: string | null;
    readonly bisCertExpiry: Date | null;
    readonly bpaFree: boolean;
    readonly hasSmallParts: boolean;
  };
  readonly seo: { readonly title: string | null; readonly description: string | null; readonly index: boolean };
}): ProductFormState {
  return {
    name: product.name,
    slug: product.slug,
    description: product.description,
    brand: product.brand,
    categoryId: product.categoryId,
    categorySlug: product.categorySlug,
    ageBand: product.ageBand,
    badge: product.badge ?? '',
    skills: product.skills.join(', '),
    boxItems: product.boxItems.join(', '),
    bisCertified: product.safety.bisCertified,
    bisCertNo: product.safety.bisCertNo ?? '',
    bisCertExpiry:
      product.safety.bisCertExpiry === null
        ? ''
        : product.safety.bisCertExpiry.toISOString().slice(0, 10),
    bpaFree: product.safety.bpaFree,
    hasSmallParts: product.safety.hasSmallParts,
    seoTitle: product.seo.title ?? '',
    seoDescription: product.seo.description ?? '',
    seoIndex: product.seo.index,
  };
}

/** The next status a control offers, given the current one — the publish/unpublish/archive verbs. */
export function statusActions(status: ProductStatus): readonly {
  readonly to: ProductStatus;
  readonly label: string;
}[] {
  switch (status) {
    case 'draft':
      return [
        { to: 'active', label: 'Publish' },
        { to: 'archived', label: 'Archive' },
      ];
    case 'active':
      return [
        { to: 'draft', label: 'Unpublish' },
        { to: 'archived', label: 'Archive' },
      ];
    case 'archived':
      // Archived cannot go straight to active — it returns to draft first (the state machine).
      return [{ to: 'draft', label: 'Restore to draft' }];
  }
}
