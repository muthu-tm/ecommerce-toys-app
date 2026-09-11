// @ts-check
/**
 * Emits `apps/api/openapi.json` from the shared Zod contracts.
 *
 * The spec is generated, never hand-maintained: request and response schemas live in
 * `@romp/contracts` and validate at runtime, so the document and the behaviour cannot drift.
 * This script defines the *paths* — the routes and which components each uses — and pulls
 * the component schemas and error responses from the registry.
 *
 * v1.0 documents the identity surface, which is what `apps/api` currently serves. Later
 * routes are added here as they land, beside their handlers. `--check` fails when the
 * committed file is stale, so a schema change cannot merge without the spec updating.
 *
 * Usage:
 *   node scripts/openapi.mjs           # write apps/api/openapi.json
 *   node scripts/openapi.mjs --check   # fail if the committed file is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { buildOpenApiDocument, errorResponses, schemaRef } from '@romp/contracts/openapi';

const OUTFILE = new URL('../openapi.json', import.meta.url);

/** application/json request body referencing a registered component. */
const jsonBody = (id) => ({
  required: true,
  content: { 'application/json': { schema: schemaRef(id) } },
});

/** application/json 2xx response referencing a component. */
const jsonResponse = (description, id) => ({
  description,
  content: { 'application/json': { schema: schemaRef(id) } },
});

const paths = {
  '/v1/health': {
    get: {
      summary: 'Liveness',
      security: [],
      responses: { 200: { description: 'The service is up; returns version and commit.' } },
    },
  },
  '/v1/auth/register': {
    post: {
      summary: 'Register with email or mobile + password',
      security: [],
      requestBody: jsonBody('RegisterRequest'),
      responses: {
        201: jsonResponse('Account created.', 'RegisterResponse'),
        ...errorResponses([
          'VALIDATION_FAILED',
          'WEAK_PASSWORD',
          'IDENTIFIER_TAKEN',
          'RATE_LIMITED',
        ]),
      },
    },
  },
  '/v1/auth/check-identifier': {
    post: {
      summary: 'Check whether an identifier is available',
      security: [],
      requestBody: jsonBody('CheckIdentifierRequest'),
      responses: {
        200: jsonResponse('Availability.', 'CheckIdentifierResponse'),
        ...errorResponses(['VALIDATION_FAILED', 'RATE_LIMITED']),
      },
    },
  },
  '/v1/auth/password-change': {
    post: {
      summary: 'Change password (revokes other sessions)',
      requestBody: jsonBody('PasswordChangeRequest'),
      responses: {
        204: { description: 'Password changed; other sessions revoked.' },
        ...errorResponses(['VALIDATION_FAILED', 'WEAK_PASSWORD', 'UNAUTHENTICATED']),
      },
    },
  },
  '/v1/me': {
    get: {
      summary: 'The signed-in customer’s profile',
      responses: {
        200: jsonResponse('Profile.', 'MeResponse'),
        ...errorResponses(['UNAUTHENTICATED', 'NOT_FOUND']),
      },
    },
    patch: {
      summary: 'Update the signed-in customer’s profile',
      requestBody: jsonBody('MeUpdateRequest'),
      responses: {
        200: jsonResponse('Updated profile.', 'MeResponse'),
        ...errorResponses(['VALIDATION_FAILED', 'UNAUTHENTICATED', 'NOT_FOUND']),
      },
    },
  },
  '/v1/admin/me': {
    get: {
      summary: 'Admin profile and claim confirmation',
      responses: {
        200: { description: 'The operator uid and role.' },
        ...errorResponses(['UNAUTHENTICATED', 'FORBIDDEN']),
      },
    },
  },
  '/v1/admin/users/{uid}/password-reset': {
    post: {
      summary: 'Mint a single-use password-reset link (WhatsApp-assisted)',
      parameters: [{ name: 'uid', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        200: { description: 'A single-use, short-TTL reset link for the admin to relay.' },
        ...errorResponses(['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'RATE_LIMITED']),
      },
    },
  },
  '/v1/admin/products': {
    post: {
      summary: 'Create a draft product',
      requestBody: jsonBody('CreateProductRequest'),
      responses: {
        201: jsonResponse('The created product id and slug.', 'CreateProductResponse'),
        ...errorResponses(['VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'RATE_LIMITED']),
      },
    },
  },
  '/v1/admin/products/{id}': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    patch: {
      summary: 'Edit product content',
      requestBody: jsonBody('UpdateProductRequest'),
      responses: {
        204: { description: 'Product updated; storefront tags revalidated.' },
        ...errorResponses([
          'VALIDATION_FAILED',
          'UNAUTHENTICATED',
          'FORBIDDEN',
          'NOT_FOUND',
          'RATE_LIMITED',
        ]),
      },
    },
  },
  '/v1/admin/products/{id}/status': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    post: {
      summary: 'Publish, unpublish or archive a product',
      requestBody: jsonBody('ProductStatusChangeRequest'),
      responses: {
        204: { description: 'Status changed.' },
        ...errorResponses([
          'VALIDATION_FAILED',
          'INVALID_STATE_TRANSITION',
          'UNAUTHENTICATED',
          'FORBIDDEN',
          'NOT_FOUND',
          'RATE_LIMITED',
        ]),
      },
    },
  },
  '/v1/admin/products/{id}/variants': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    post: {
      summary: 'Add a variant, refreshing the product summary',
      requestBody: jsonBody('CreateVariantRequest'),
      responses: {
        201: jsonResponse('The created variant id.', 'CreateVariantResponse'),
        ...errorResponses([
          'VALIDATION_FAILED',
          'UNAUTHENTICATED',
          'FORBIDDEN',
          'NOT_FOUND',
          'RATE_LIMITED',
        ]),
      },
    },
  },
  '/v1/admin/products/{id}/variants/{variantId}': {
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'variantId', in: 'path', required: true, schema: { type: 'string' } },
    ],
    patch: {
      summary: 'Edit a variant, refreshing the product summary',
      requestBody: jsonBody('UpdateVariantRequest'),
      responses: {
        204: { description: 'Variant updated.' },
        ...errorResponses([
          'VALIDATION_FAILED',
          'UNAUTHENTICATED',
          'FORBIDDEN',
          'NOT_FOUND',
          'RATE_LIMITED',
        ]),
      },
    },
  },
  '/v1/admin/products/{id}/variants/{variantId}/inventory': {
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'variantId', in: 'path', required: true, schema: { type: 'string' } },
    ],
    post: {
      summary: 'Adjust a variant’s stock at one warehouse',
      requestBody: jsonBody('InventoryAdjustRequest'),
      responses: {
        200: jsonResponse('The stock balance after the adjustment.', 'InventoryResponse'),
        ...errorResponses([
          'VALIDATION_FAILED',
          'INVALID_STATE_TRANSITION',
          'UNAUTHENTICATED',
          'FORBIDDEN',
          'NOT_FOUND',
          'RATE_LIMITED',
        ]),
      },
    },
  },
  '/v1/admin/products/{id}/media': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    post: {
      summary: 'Register a media upload slot',
      requestBody: jsonBody('RegisterMediaRequest'),
      responses: {
        201: jsonResponse('The Storage object path to upload to.', 'RegisterMediaResponse'),
        ...errorResponses([
          'VALIDATION_FAILED',
          'UNAUTHENTICATED',
          'FORBIDDEN',
          'NOT_FOUND',
          'RATE_LIMITED',
        ]),
      },
    },
  },
  '/v1/admin/categories': {
    post: {
      summary: 'Create a category',
      requestBody: jsonBody('CreateCategoryRequest'),
      responses: {
        201: jsonResponse('The created category id and slug.', 'CreateCategoryResponse'),
        ...errorResponses([
          'VALIDATION_FAILED',
          'IDENTIFIER_TAKEN',
          'INVALID_STATE_TRANSITION',
          'UNAUTHENTICATED',
          'FORBIDDEN',
          'RATE_LIMITED',
        ]),
      },
    },
  },
  '/v1/admin/categories/reorder': {
    post: {
      summary: 'Reorder categories',
      requestBody: jsonBody('ReorderCategoriesRequest'),
      responses: {
        204: { description: 'Categories reordered.' },
        ...errorResponses(['VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'RATE_LIMITED']),
      },
    },
  },
  '/v1/admin/categories/{id}': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    patch: {
      summary: 'Edit a category',
      requestBody: jsonBody('UpdateCategoryRequest'),
      responses: {
        204: { description: 'Category updated.' },
        ...errorResponses([
          'VALIDATION_FAILED',
          'INVALID_STATE_TRANSITION',
          'UNAUTHENTICATED',
          'FORBIDDEN',
          'NOT_FOUND',
          'RATE_LIMITED',
        ]),
      },
    },
    delete: {
      summary: 'Delete a category (refused while products or children depend on it)',
      responses: {
        204: { description: 'Category deleted.' },
        ...errorResponses([
          'INVALID_STATE_TRANSITION',
          'UNAUTHENTICATED',
          'FORBIDDEN',
          'NOT_FOUND',
          'RATE_LIMITED',
        ]),
      },
    },
  },
  '/v1/cart': {
    get: {
      summary: 'Read the cart (guest by cookie or signed-in by token)',
      responses: {
        200: jsonResponse('The cart as rendered.', 'CartView'),
        ...errorResponses(['RATE_LIMITED']),
      },
    },
    patch: {
      summary: 'Toggle gift wrap',
      requestBody: jsonBody('UpdateCartRequest'),
      responses: {
        200: jsonResponse('The updated cart.', 'CartView'),
        ...errorResponses(['VALIDATION_FAILED', 'RATE_LIMITED']),
      },
    },
  },
  '/v1/cart/items': {
    post: {
      summary: 'Add a variant to the cart, or set its quantity',
      requestBody: jsonBody('AddCartItemRequest'),
      responses: {
        200: jsonResponse('The updated cart.', 'CartView'),
        ...errorResponses(['VALIDATION_FAILED', 'INVALID_STATE_TRANSITION', 'RATE_LIMITED']),
      },
    },
  },
  '/v1/cart/items/{variantId}': {
    parameters: [{ name: 'variantId', in: 'path', required: true, schema: { type: 'string' } }],
    delete: {
      summary: 'Remove a line from the cart',
      responses: {
        200: jsonResponse('The updated cart.', 'CartView'),
        ...errorResponses(['RATE_LIMITED']),
      },
    },
  },
  '/v1/cart/merge': {
    post: {
      summary: 'Merge the guest cart into the signed-in account',
      responses: {
        200: jsonResponse('The merged cart.', 'CartView'),
        ...errorResponses(['UNAUTHENTICATED', 'RATE_LIMITED']),
      },
    },
  },
  '/v1/checkout/quote': {
    post: {
      summary: 'Quote the signed-in customer’s cart at live prices',
      requestBody: jsonBody('CheckoutQuoteRequest'),
      responses: {
        200: jsonResponse('The recomputed quote.', 'CheckoutQuoteResponse'),
        ...errorResponses(['VALIDATION_FAILED', 'INVALID_STATE_TRANSITION', 'UNAUTHENTICATED']),
      },
    },
  },
  '/v1/orders': {
    post: {
      summary: 'Place the signed-in customer’s cart as an order (idempotent)',
      requestBody: jsonBody('PlaceOrderRequest'),
      responses: {
        201: jsonResponse('The placed order, with the UPI QR payload.', 'PlaceOrderResponse'),
        ...errorResponses([
          'VALIDATION_FAILED',
          'INSUFFICIENT_STOCK',
          'INVALID_STATE_TRANSITION',
          'UNAUTHENTICATED',
          'NOT_FOUND',
          'RATE_LIMITED',
        ]),
      },
    },
  },
  '/v1/orders/{id}': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    get: {
      summary: 'Read one of the caller’s own orders',
      responses: {
        200: jsonResponse('The order as the customer views it.', 'OrderView'),
        ...errorResponses(['UNAUTHENTICATED', 'NOT_FOUND']),
      },
    },
  },
  '/v1/orders/{id}/payment-proof': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    post: {
      summary: 'Submit a UPI payment reference (and optional proof) for an order (idempotent)',
      requestBody: jsonBody('SubmitPaymentProofRequest'),
      responses: {
        200: jsonResponse('The order moved into verification.', 'SubmitPaymentProofResponse'),
        ...errorResponses([
          'VALIDATION_FAILED',
          'DUPLICATE_PAYMENT_REFERENCE',
          'RESERVATION_EXPIRED',
          'INVALID_STATE_TRANSITION',
          'UNAUTHENTICATED',
          'NOT_FOUND',
          'RATE_LIMITED',
        ]),
      },
    },
  },
  '/v1/admin/orders': {
    get: {
      summary:
        'List orders — newest first, filterable by status or fulfilment, or searched by humanId',
      parameters: [
        { name: 'status', in: 'query', required: false, schema: schemaRef('OrderStatus') },
        {
          name: 'fulfilmentStatus',
          in: 'query',
          required: false,
          schema: schemaRef('FulfilmentStatus'),
        },
        { name: 'humanId', in: 'query', required: false, schema: schemaRef('HumanOrderId') },
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
        { name: 'cursor', in: 'query', required: false, schema: schemaRef('Cursor') },
      ],
      responses: {
        200: jsonResponse('A page of orders, newest first.', 'AdminOrderListResponse'),
        ...errorResponses(['VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN']),
      },
    },
  },
  '/v1/admin/orders/{id}/verify-payment': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    post: {
      summary: 'Verify a payment: commit stock and mark the order paid (exact amount)',
      requestBody: jsonBody('VerifyPaymentRequest'),
      responses: {
        200: jsonResponse('The paid order.', 'OrderView'),
        ...errorResponses([
          'VALIDATION_FAILED',
          'PAYMENT_AMOUNT_MISMATCH',
          'INVALID_STATE_TRANSITION',
          'UNAUTHENTICATED',
          'FORBIDDEN',
          'NOT_FOUND',
          'RATE_LIMITED',
        ]),
      },
    },
  },
  '/v1/admin/orders/{id}/reject-payment': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    post: {
      summary: 'Reject a payment the admin could not match; the customer may resubmit',
      requestBody: jsonBody('RejectPaymentRequest'),
      responses: {
        200: jsonResponse('The rejected order, with the reason.', 'OrderView'),
        ...errorResponses([
          'VALIDATION_FAILED',
          'INVALID_STATE_TRANSITION',
          'UNAUTHENTICATED',
          'FORBIDDEN',
          'NOT_FOUND',
          'RATE_LIMITED',
        ]),
      },
    },
  },
  '/v1/admin/orders/{id}/fulfilment': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    post: {
      summary: 'Advance fulfilment: pack, ship (with carrier and tracking), deliver, or hold',
      requestBody: jsonBody('FulfilmentRequest'),
      responses: {
        200: jsonResponse('The order at its new fulfilment stage.', 'OrderView'),
        ...errorResponses([
          'VALIDATION_FAILED',
          'INVALID_STATE_TRANSITION',
          'UNAUTHENTICATED',
          'FORBIDDEN',
          'NOT_FOUND',
          'RATE_LIMITED',
        ]),
      },
    },
  },
  '/v1/admin/orders/{id}/cancel': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    post: {
      summary: 'Cancel an order: release a held reservation, or restock a paid order',
      requestBody: jsonBody('CancelOrderRequest'),
      responses: {
        200: jsonResponse('The cancelled order.', 'OrderView'),
        ...errorResponses([
          'VALIDATION_FAILED',
          'INVALID_STATE_TRANSITION',
          'UNAUTHENTICATED',
          'FORBIDDEN',
          'NOT_FOUND',
          'RATE_LIMITED',
        ]),
      },
    },
  },
  '/v1/admin/refunds': {
    post: {
      summary: 'Issue a full or partial refund (owner-only, append-only, optional restock)',
      requestBody: jsonBody('IssueRefundRequest'),
      responses: {
        200: jsonResponse('The refund result.', 'IssueRefundResponse'),
        ...errorResponses([
          'VALIDATION_FAILED',
          'REFUND_EXCEEDS_REFUNDABLE',
          'INVALID_STATE_TRANSITION',
          'UNAUTHENTICATED',
          'FORBIDDEN',
          'NOT_FOUND',
          'RATE_LIMITED',
        ]),
      },
    },
  },
  '/v1/admin/analytics/daily': {
    get: {
      summary: 'The daily analytics rollups for a date range — the dashboard series',
      parameters: [
        { name: 'from', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'to', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        200: jsonResponse('The rollup rows, oldest first.', 'DailyAnalyticsResponse'),
        ...errorResponses(['VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN']),
      },
    },
  },
};

const document = buildOpenApiDocument({
  title: 'ROMP API',
  version: '1.0.0',
  description:
    'The ROMP commerce API. Every write in the system passes through here. Generated from Zod contracts.',
  paths,
});

const serialised = `${JSON.stringify(document, null, 2)}\n`;

const check = process.argv.includes('--check');
if (check) {
  let existing = '';
  try {
    existing = readFileSync(OUTFILE, 'utf8');
  } catch {
    console.error('openapi.json is missing. Run `pnpm --filter @romp/api openapi:generate`.');
    process.exit(1);
  }
  if (existing !== serialised) {
    console.error(
      'openapi.json is stale. A contract changed without regenerating the spec. Run `pnpm --filter @romp/api openapi:generate`.',
    );
    process.exit(1);
  }
  console.log('openapi.json is up to date.');
} else {
  writeFileSync(OUTFILE, serialised);
  console.log(`Wrote ${OUTFILE.pathname}`);
}
