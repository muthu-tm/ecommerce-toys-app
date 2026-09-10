import { randomUUID } from 'node:crypto';

import type { MediaItem, ProductDoc, RegisterMediaRequest, VariantDoc } from '@romp/contracts';
import {
  CreateProductRequestSchema,
  CreateVariantRequestSchema,
  InventoryAdjustRequestSchema,
  ProductStatusChangeRequestSchema,
  RegisterMediaRequestSchema,
  UpdateProductRequestSchema,
  UpdateVariantRequestSchema,
  money,
} from '@romp/contracts';
import { deriveSlug, productSearchParts } from '@romp/core';
import {
  IllegalProductTransitionError,
  NoActiveVariantError,
  ProductNotFoundError,
  StockAdjustmentError,
  VariantNotFoundError,
  adjustInventory,
  buildSearchTokens,
  createProduct,
  createVariant,
  registerMediaSlot,
  setProductStatus,
  updateProduct,
  updateVariant,
} from '@romp/data';
import {
  InvalidStateTransitionError,
  NotFoundError,
  ValidationFailedError,
  parseOrThrow,
} from '@romp/observability';
import storeConfig from '@romp/store-config/generated/store-config.json';

import type { RompApp } from '../app';
import { requireAdminHook } from '../plugins/auth';
import { RATE_LIMITS, rateLimitKey } from '../plugins/rate-limit';
import { requireOperator } from '../request-context';
import { tagsForProduct } from '../revalidation';

/**
 * Backoffice product, variant and media routes.
 *
 * Every route here is admin-gated (`requireAdminHook`) and writes through `@romp/data`,
 * which is the only place a catalogue mutation happens. The handlers assemble a validated
 * document from the wire request plus the `@romp/core` helpers — the slug, the search
 * tokens, the empty starting summary — so the pure decisions stay testable and this module
 * is the HTTP shell around them. Publication and content edits revalidate the storefront's
 * ISR tags on the way out; a revalidation failure is logged, never fatal.
 *
 * The `@romp/data` write errors are mapped to problem+json here: a missing product to a
 * 404, an illegal status transition or a publish with no active variant to a 409. Mapping at
 * the route keeps the repository free of HTTP concerns.
 */
export function registerProductRoutes(app: RompApp): void {
  const { context } = app.deps;

  const limit = (request: Parameters<typeof rateLimitKey>[0]): void => {
    app.rateLimiter.consume(
      rateLimitKey(request, 'adminCatalogueWrite'),
      RATE_LIMITS.adminCatalogueWrite,
    );
  };

  /** Fires the ISR revalidation seam for a product, swallowing (but logging) failures. */
  const revalidate = (product: {
    readonly slug: string;
    readonly categorySlug: string;
    readonly ageBand: string;
  }): void => {
    const { revalidate: revalidateTags, logger } = app.deps;
    if (revalidateTags === undefined) return;
    void revalidateTags(tagsForProduct(product)).catch((error: unknown) => {
      // A stale page is a smaller problem than a failed publish; the time-based ISR floor
      // will refresh it. Log so a persistently broken revalidation is visible.
      logger.warn({ event: 'revalidate.failed', slug: product.slug, error }, 'revalidate.failed');
    });
  };

  // --- create -------------------------------------------------------------
  app.post('/v1/admin/products', { preHandler: requireAdminHook }, async (request, reply) => {
    requireOperator(request);
    limit(request);

    const body = parseOrThrow(CreateProductRequestSchema, request.body);

    // Derive the slug from the name unless the admin supplied one. `deriveSlug` throws on a
    // name with nothing sluggable, which becomes a field-level validation error rather than
    // a 500.
    let slug;
    try {
      slug = body.slug ?? deriveSlug(body.name);
    } catch {
      throw new ValidationFailedError([
        { path: 'slug', message: 'Could not derive a slug from the name; provide one.' },
      ]);
    }

    const now = context.clock.now();
    const searchTokens = buildSearchTokens(
      productSearchParts({
        name: body.name,
        brand: body.brand,
        categoryName: body.categorySlug,
        ageBandLabel: body.ageBand,
      }),
    );

    const product: ProductDoc = {
      slug,
      name: body.name,
      description: body.description,
      brand: body.brand,
      categoryId: body.categoryId as ProductDoc['categoryId'],
      categorySlug: body.categorySlug,
      ageBand: body.ageBand,
      status: 'draft',
      badge: body.badge,
      priceFromMinor: money(0),
      mrpFromMinor: money(0),
      variantSummary: [],
      media: [],
      skills: [...body.skills],
      boxItems: [...body.boxItems],
      safety: {
        bisCertified: body.safety.bisCertified,
        bisCertNo: body.safety.bisCertNo,
        bisCertExpiry:
          body.safety.bisCertExpiry === null
            ? null
            : new Date(`${body.safety.bisCertExpiry}T00:00:00.000Z`),
        bpaFree: body.safety.bpaFree,
        hasSmallParts: body.safety.hasSmallParts,
      },
      ratingAvg: 0,
      ratingCount: 0,
      searchTokens: [...searchTokens],
      // A draft is never indexed, regardless of what the SEO tab shows for the eventual
      // published state — publication sets the index flag.
      seo: { title: body.seo.title, description: body.seo.description, index: false },
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
    };

    const { id } = await createProduct(context, request.caller, product);
    return reply.code(201).send({ id, slug });
  });

  // --- edit content -------------------------------------------------------
  app.patch('/v1/admin/products/:id', { preHandler: requireAdminHook }, async (request, reply) => {
    requireOperator(request);
    limit(request);

    const { id } = request.params as { id: string };
    const body = parseOrThrow(UpdateProductRequestSchema, request.body);

    const searchTokens = buildSearchTokens(
      productSearchParts({
        name: body.name,
        brand: body.brand,
        categoryName: body.categorySlug,
        ageBandLabel: body.ageBand,
      }),
    );

    try {
      await updateProduct(context, request.caller, id, {
        name: body.name,
        description: body.description,
        brand: body.brand,
        categoryId: body.categoryId as ProductDoc['categoryId'],
        categorySlug: body.categorySlug,
        ageBand: body.ageBand,
        badge: body.badge,
        skills: body.skills,
        boxItems: body.boxItems,
        safety: {
          bisCertified: body.safety.bisCertified,
          bisCertNo: body.safety.bisCertNo,
          bisCertExpiry:
            body.safety.bisCertExpiry === null
              ? null
              : new Date(`${body.safety.bisCertExpiry}T00:00:00.000Z`),
          bpaFree: body.safety.bpaFree,
          hasSmallParts: body.safety.hasSmallParts,
        },
        media: [],
        searchTokens,
        seo: body.seo,
      });
    } catch (error) {
      throw mapCatalogueError(error);
    }

    revalidate({ slug: id, categorySlug: body.categorySlug, ageBand: body.ageBand });
    return reply.code(204).send();
  });

  // --- publish / unpublish / archive --------------------------------------
  app.post(
    '/v1/admin/products/:id/status',
    { preHandler: requireAdminHook },
    async (request, reply) => {
      requireOperator(request);
      limit(request);

      const { id } = request.params as { id: string };
      const body = parseOrThrow(ProductStatusChangeRequestSchema, request.body);

      try {
        await setProductStatus(context, request.caller, id, body.status);
      } catch (error) {
        throw mapCatalogueError(error);
      }

      // Revalidate against the product's slug — which, for admin-created products, is not the
      // document ID. The status route does not carry the slug/category, so it busts the
      // coarse catalogue tag; the storefront's per-product tag is busted by the edit route
      // and by the time-based floor.
      const { revalidate: revalidateTags } = app.deps;
      if (revalidateTags !== undefined) {
        void revalidateTags(['catalogue']).catch(() => undefined);
      }

      return reply.code(204).send();
    },
  );

  // --- variants -----------------------------------------------------------
  app.post(
    '/v1/admin/products/:id/variants',
    { preHandler: requireAdminHook },
    async (request, reply) => {
      requireOperator(request);
      limit(request);

      const { id } = request.params as { id: string };
      const body = parseOrThrow(CreateVariantRequestSchema, request.body);
      const now = context.clock.now();

      const variant: VariantDoc = {
        productId: id as VariantDoc['productId'],
        name: body.name,
        sku: body.sku,
        priceMinor: body.priceMinor,
        mrpMinor: body.mrpMinor,
        options: { ...body.options },
        active: body.active,
        weightGrams: body.weightGrams,
        createdAt: now,
        updatedAt: now,
      };

      let created;
      try {
        created = await createVariant(context, request.caller, id, variant);
      } catch (error) {
        throw mapCatalogueError(error);
      }
      return reply.code(201).send({ id: created.id });
    },
  );

  app.patch(
    '/v1/admin/products/:id/variants/:variantId',
    { preHandler: requireAdminHook },
    async (request, reply) => {
      requireOperator(request);
      limit(request);

      const { id, variantId } = request.params as { id: string; variantId: string };
      const body = parseOrThrow(UpdateVariantRequestSchema, request.body);

      try {
        await updateVariant(context, request.caller, id, variantId, {
          name: body.name,
          sku: body.sku,
          priceMinor: body.priceMinor,
          mrpMinor: body.mrpMinor,
          options: body.options,
          active: body.active,
          weightGrams: body.weightGrams,
        });
      } catch (error) {
        throw mapCatalogueError(error);
      }

      return reply.code(204).send();
    },
  );

  // --- inventory ----------------------------------------------------------
  app.post(
    '/v1/admin/products/:id/variants/:variantId/inventory',
    { preHandler: requireAdminHook },
    async (request, reply) => {
      requireOperator(request);
      limit(request);

      const { id, variantId } = request.params as { id: string; variantId: string };
      const body = parseOrThrow(InventoryAdjustRequestSchema, request.body);

      // The product is the one in the path; a manual adjustment has no order/refund behind
      // it (refId null). A brand-new inventory record is seeded with the store's configured
      // low-stock threshold, the same number the storefront and dispatcher read.
      let result;
      try {
        result = await adjustInventory(context, request.caller, {
          variantId,
          productId: id,
          warehouseId: body.warehouseId,
          delta: body.delta,
          reason: body.reason,
          note: body.note,
          refId: null,
          lowStockThreshold: storeConfig.commerce.lowStockThreshold,
        });
      } catch (error) {
        throw mapCatalogueError(error);
      }

      return reply.code(200).send({
        variantId,
        onHandTotal: result.onHandTotal,
        reserved: result.reserved,
        stock: result.stock,
      });
    },
  );

  // --- media --------------------------------------------------------------
  app.post(
    '/v1/admin/products/:id/media',
    { preHandler: requireAdminHook },
    async (request, reply) => {
      requireOperator(request);
      limit(request);

      const { id } = request.params as { id: string };
      const body = parseOrThrow(RegisterMediaRequestSchema, request.body);

      // Allocate a unique object path under the product. The extension comes from the
      // declared content type, which is only a claim — the finalize Function re-derives it —
      // but a `.jpg` that is actually a PNG is harmless for the path; the quarantine is what
      // matters. The client uploads to this path with the Storage SDK, gated by the rules.
      const objectPath = `products/${id}/${randomUUID()}.${MEDIA_EXTENSION[body.contentType]}`;

      // The pending entry carries 1×1 sentinel dimensions — the schema requires positive
      // integers — until finalize writes the real ones.
      const pending: MediaItem = {
        path: objectPath,
        alt: body.alt,
        width: 1,
        height: 1,
        blurhash: null,
        order: Number.MAX_SAFE_INTEGER, // appended last; normalised on write.
      };

      try {
        await registerMediaSlot(context, request.caller, id, pending);
      } catch (error) {
        throw mapCatalogueError(error);
      }
      return reply.code(201).send({ path: objectPath });
    },
  );
}

/** The file extension for each allowed upload content type. */
const MEDIA_EXTENSION: Record<RegisterMediaRequest['contentType'], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/**
 * Maps a `@romp/data` catalogue write error to the problem+json error the client sees.
 *
 * A missing product or variant is a 404 (the same shape as any not-found). An illegal status
 * transition or a publish with no active variant is a 409 conflict — the request was
 * well-formed but conflicts with the resource's state — with a message an operator can act
 * on. Anything else is re-thrown for the core error handler to treat as a 500.
 */
function mapCatalogueError(error: unknown): Error {
  if (error instanceof ProductNotFoundError || error instanceof VariantNotFoundError) {
    return new NotFoundError({ detail: error.message });
  }
  if (error instanceof IllegalProductTransitionError) {
    return new InvalidStateTransitionError({
      detail: `Cannot change status from "${error.from}" to "${error.to}". Allowed: ${error.allowed.join(', ') || 'none'}.`,
    });
  }
  if (error instanceof NoActiveVariantError) {
    return new InvalidStateTransitionError({
      detail: 'A product needs at least one active variant to publish.',
    });
  }
  if (error instanceof StockAdjustmentError) {
    // A refusal to take a warehouse below zero (or below its reservations) is a conflict with
    // the resource's current state, not a malformed request — the same 409 shape as an
    // illegal product transition.
    return new InvalidStateTransitionError({
      detail:
        error.reason === 'oversell'
          ? 'The adjustment would leave fewer units than are already reserved.'
          : 'The adjustment would take a warehouse below zero stock.',
    });
  }
  return error instanceof Error ? error : new Error(String(error));
}
