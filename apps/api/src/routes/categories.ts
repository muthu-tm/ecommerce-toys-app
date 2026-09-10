import {
  CreateCategoryRequestSchema,
  ReorderCategoriesRequestSchema,
  UpdateCategoryRequestSchema,
} from '@romp/contracts';
import { deriveSlug } from '@romp/core';
import {
  CategoryHasChildrenError,
  CategoryHasProductsError,
  CategoryNotFoundError,
  CategorySlugTakenError,
  IllegalCategoryParentError,
  createCategory,
  deleteCategory,
  reorderCategories,
  updateCategory,
} from '@romp/data';
import {
  IdentifierTakenError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationFailedError,
  parseOrThrow,
} from '@romp/observability';

import type { RompApp } from '../app';
import { requireAdminHook } from '../plugins/auth';
import { RATE_LIMITS, rateLimitKey } from '../plugins/rate-limit';
import { requireOperator } from '../request-context';

/**
 * Backoffice category routes.
 *
 * Categories are the storefront's navigation and its facet sidebar, and every mutation is
 * admin-gated and written through `@romp/data`, where the tree invariants live. The handlers are
 * thin: validate the wire request, derive a slug when a create did not pin one, call the write,
 * and map the repository's typed errors to problem+json — a duplicate slug to a 409, a bad parent
 * or a delete blocked by dependents to a 409, a missing category to a 404. `productCount` is never
 * touched here; the product-write Function owns it.
 */
export function registerCategoryRoutes(app: RompApp): void {
  const { context } = app.deps;

  const limit = (request: Parameters<typeof rateLimitKey>[0]): void => {
    app.rateLimiter.consume(
      rateLimitKey(request, 'adminCatalogueWrite'),
      RATE_LIMITS.adminCatalogueWrite,
    );
  };

  // --- create -------------------------------------------------------------
  app.post('/v1/admin/categories', { preHandler: requireAdminHook }, async (request, reply) => {
    requireOperator(request);
    limit(request);

    const body = parseOrThrow(CreateCategoryRequestSchema, request.body);

    // Derive the slug from the name unless the operator pinned one. An unsluggable name is a
    // field-level validation error rather than a 500.
    let slug;
    try {
      slug = body.slug ?? deriveSlug(body.name);
    } catch {
      throw new ValidationFailedError([
        { path: 'slug', message: 'Could not derive a slug from the name; provide one.' },
      ]);
    }

    let created;
    try {
      created = await createCategory(context, request.caller, {
        name: body.name,
        slug,
        parentId: body.parentId,
        active: body.active,
        showInNav: body.showInNav,
        showInFilters: body.showInFilters,
        sortOrder: body.sortOrder,
      });
    } catch (error) {
      throw mapCategoryError(error);
    }

    return reply.code(201).send({ id: created.id, slug });
  });

  // --- edit ---------------------------------------------------------------
  app.patch(
    '/v1/admin/categories/:id',
    { preHandler: requireAdminHook },
    async (request, reply) => {
      requireOperator(request);
      limit(request);

      const { id } = request.params as { id: string };
      const body = parseOrThrow(UpdateCategoryRequestSchema, request.body);

      try {
        await updateCategory(context, request.caller, id, {
          name: body.name,
          parentId: body.parentId,
          active: body.active,
          showInNav: body.showInNav,
          showInFilters: body.showInFilters,
          sortOrder: body.sortOrder,
        });
      } catch (error) {
        throw mapCategoryError(error);
      }

      return reply.code(204).send();
    },
  );

  // --- reorder ------------------------------------------------------------
  app.post(
    '/v1/admin/categories/reorder',
    { preHandler: requireAdminHook },
    async (request, reply) => {
      requireOperator(request);
      limit(request);

      const body = parseOrThrow(ReorderCategoriesRequestSchema, request.body);

      try {
        await reorderCategories(context, request.caller, body.orders);
      } catch (error) {
        throw mapCategoryError(error);
      }

      return reply.code(204).send();
    },
  );

  // --- delete -------------------------------------------------------------
  app.delete(
    '/v1/admin/categories/:id',
    { preHandler: requireAdminHook },
    async (request, reply) => {
      requireOperator(request);
      limit(request);

      const { id } = request.params as { id: string };

      try {
        await deleteCategory(context, request.caller, id);
      } catch (error) {
        throw mapCategoryError(error);
      }

      return reply.code(204).send();
    },
  );
}

/**
 * Maps a `@romp/data` category write error to the problem+json error the client sees.
 *
 * A missing category is a 404. A duplicate slug is a 409 that reuses the `IDENTIFIER_TAKEN`
 * contract — the slug is an identifier and this is the same "already claimed" conflict as a
 * taken login. An illegal parent, or a delete blocked because products or children still depend
 * on the category, is a 409 conflict with the resource's state. Anything else re-throws for the
 * core handler to treat as a 500.
 */
function mapCategoryError(error: unknown): Error {
  if (error instanceof CategoryNotFoundError) {
    return new NotFoundError({ detail: error.message });
  }
  if (error instanceof CategorySlugTakenError) {
    return new IdentifierTakenError({ detail: error.message });
  }
  if (error instanceof IllegalCategoryParentError) {
    return new InvalidStateTransitionError({ detail: parentErrorDetail(error.reason) });
  }
  if (error instanceof CategoryHasProductsError || error instanceof CategoryHasChildrenError) {
    return new InvalidStateTransitionError({ detail: error.message });
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** A human-actionable message for each illegal-parent reason. */
function parentErrorDetail(reason: IllegalCategoryParentError['reason']): string {
  switch (reason) {
    case 'self_parent':
      return 'A category cannot be its own parent.';
    case 'parent_not_found':
      return 'The chosen parent category does not exist.';
    case 'too_deep':
      return 'Categories nest one level only — the chosen parent is already a sub-category.';
    case 'would_orphan_children':
      return 'This category has sub-categories, so it cannot itself become a sub-category.';
  }
}
