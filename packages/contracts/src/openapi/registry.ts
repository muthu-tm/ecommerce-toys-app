import { z } from 'zod';

import { InventoryLedgerReasonSchema, QuantitySchema } from '../domain/inventory';
import {
  DeliverySpeedSchema,
  FulfilmentStatusSchema,
  OrderStatusSchema,
  PaymentMethodSchema,
} from '../domain/order';
import { AgeBandSchema, ProductStatusSchema } from '../domain/product';
import { RefundModeSchema, RefundReasonSchema } from '../domain/refund';
import { ReservationStatusSchema } from '../domain/reservation';
import { RatingSchema, ReviewStatusSchema } from '../domain/review';
import { AudienceSchema, EventTypeSchema, NotificationTypeSchema } from '../events';
import {
  CreateProductRequestSchema,
  CreateProductResponseSchema,
  CreateVariantRequestSchema,
  CreateVariantResponseSchema,
  InventoryAdjustRequestSchema,
  InventoryResponseSchema,
  ProductStatusChangeRequestSchema,
  RegisterMediaRequestSchema,
  RegisterMediaResponseSchema,
  UpdateProductRequestSchema,
  UpdateVariantRequestSchema,
} from '../http/admin-catalogue';
import {
  CreateCategoryRequestSchema,
  CreateCategoryResponseSchema,
  ReorderCategoriesRequestSchema,
  UpdateCategoryRequestSchema,
} from '../http/admin-category';
import {
  CheckIdentifierRequestSchema,
  CheckIdentifierResponseSchema,
  MeResponseSchema,
  MeUpdateRequestSchema,
  PasswordChangeRequestSchema,
  RegisterRequestSchema,
  RegisterResponseSchema,
} from '../http/auth';
import { AddCartItemRequestSchema, CartViewSchema, UpdateCartRequestSchema } from '../http/cart';
import { ERROR_DEFINITIONS, ErrorCodeSchema, errorTypeUri } from '../http/error-codes';
import type { ErrorCode } from '../http/error-codes';
import {
  PROBLEM_JSON_CONTENT_TYPE,
  ProblemDetailsSchema,
  ValidationIssueSchema,
} from '../http/problem';
import { BasisPointsSchema } from '../primitives/basis-points';
import {
  E164PhoneSchema,
  EmailSchema,
  HumanOrderIdSchema,
  PincodeSchema,
  SkuSchema,
  SlugSchema,
  UpiVpaSchema,
  UtrSchema,
} from '../primitives/identifiers';
import { MoneySchema } from '../primitives/money';
import { CursorSchema } from '../primitives/pagination';

/**
 * OpenAPI generation.
 *
 * The specification is emitted from the **same Zod schemas that validate at
 * runtime**, so drift between the documented contract and actual behaviour is not
 * expressible. That is the whole reason this exists instead of a hand-written YAML.
 *
 * Implementation note worth knowing before changing anything here. This uses
 * Zod 4's built-in `toJSONSchema` against an **explicit registry** we own, rather
 * than a schema-to-OpenAPI library. Two reasons, both learned the hard way:
 *
 *  1. Those libraries work by patching `ZodType.prototype` with an `.openapi()`
 *     method. That only works if every schema and the generator share one Zod
 *     module instance — and under Vite they do not, so the patch was visible to the
 *     generator and invisible to the schemas it was generating from. A design that
 *     depends on bundler dedupe is a design that breaks quietly.
 *  2. Using our own registry object, rather than `z.globalRegistry`, means the
 *     registry is a single instance from *our* module regardless of how the
 *     bundler treats `zod`.
 *
 * It also removes a dependency and a global side effect.
 */

interface ComponentMeta {
  readonly id: string;
  readonly description?: string;
  readonly examples?: readonly unknown[];
  readonly [key: string]: unknown;
}

/** Schemas published as reusable OpenAPI components. */
export const contractRegistry = z.registry<ComponentMeta>();

function component<TSchema extends z.ZodType>(
  id: string,
  schema: TSchema,
  meta: Omit<ComponentMeta, 'id'> = {},
): TSchema {
  contractRegistry.add(schema, { id, ...meta });
  return schema;
}

// --- primitives -------------------------------------------------------------
component('Money', MoneySchema, {
  description:
    'An amount in paise (1/100 rupee). Always an integer — never a decimal or a formatted string.',
  examples: [169_999],
});
component('BasisPoints', BasisPointsSchema, {
  description: 'A rate in basis points. 1800 = 18%.',
  examples: [1_800],
});
component('Quantity', QuantitySchema, { description: 'A whole number of physical units.' });
component('Cursor', CursorSchema, {
  description: 'Opaque pagination cursor. Echo it back unchanged; do not parse it.',
});

// --- identifiers ------------------------------------------------------------
component('Email', EmailSchema, { examples: ['asha@example.com'] });
component('E164Phone', E164PhoneSchema, {
  description: 'Mobile number in E.164 form. Also a login identifier, so treat it as a credential.',
  examples: ['+919845021174'],
});
component('Sku', SkuSchema, { examples: ['BRK-2401'] });
component('Slug', SlugSchema, { examples: ['wooden-blocks'] });
component('Pincode', PincodeSchema, { examples: ['560001'] });
component('AgeBand', AgeBandSchema, {
  description: 'Configured per store, not a fixed set.',
  examples: ['6-8'],
});
component('HumanOrderId', HumanOrderIdSchema, {
  description: 'Customer-facing order number. Not the document ID, which is random.',
  examples: ['RMP-24817'],
});
component('Utr', UtrSchema, {
  description: 'UPI transaction reference, uppercased with all whitespace removed.',
  examples: ['412345678901'],
});
component('UpiVpa', UpiVpaSchema, { examples: ['romp.store@okhdfcbank'] });

// --- enums ------------------------------------------------------------------
component('OrderStatus', OrderStatusSchema);
component('FulfilmentStatus', FulfilmentStatusSchema, {
  description: 'Independent of payment status: a paid order can be on hold.',
});
component('PaymentMethod', PaymentMethodSchema);
component('DeliverySpeed', DeliverySpeedSchema);
component('ProductStatus', ProductStatusSchema);
component('ReservationStatus', ReservationStatusSchema);
component('ReviewStatus', ReviewStatusSchema);
component('Rating', RatingSchema);
component('RefundMode', RefundModeSchema);
component('RefundReason', RefundReasonSchema);
component('InventoryLedgerReason', InventoryLedgerReasonSchema);
component('EventType', EventTypeSchema);
component('NotificationType', NotificationTypeSchema);
component('Audience', AudienceSchema);
component('ErrorCode', ErrorCodeSchema);

// --- errors -----------------------------------------------------------------
component('ValidationIssue', ValidationIssueSchema);
component('ProblemDetails', ProblemDetailsSchema, {
  description:
    'RFC 7807 problem document. Branch on `code`, never on `detail`, which is human-facing and may be reworded.',
});

// --- identity ---------------------------------------------------------------
component('RegisterRequest', RegisterRequestSchema, {
  description:
    'Registration. The identifier is an email or a mobile number in any spelling; the server classifies and normalises it.',
});
component('RegisterResponse', RegisterResponseSchema, {
  description: 'The new uid and the derived login email the client signs in with.',
});
component('CheckIdentifierRequest', CheckIdentifierRequestSchema);
component('CheckIdentifierResponse', CheckIdentifierResponseSchema, {
  description: 'Availability only — never the uid, which would make this an enumeration oracle.',
});
component('PasswordChangeRequest', PasswordChangeRequestSchema);
component('MeUpdateRequest', MeUpdateRequestSchema);
component('MeResponse', MeResponseSchema, {
  description:
    'The signed-in customer’s own profile. Contact details are presence booleans, not values.',
});

// --- admin catalogue --------------------------------------------------------
component('CreateProductRequest', CreateProductRequestSchema, {
  description:
    'Create a draft product. Slug is optional — omitted, the server derives it from the name. Denormalised fields (variant summary, from-prices, search tokens) are computed server-side and omitted here.',
});
component('CreateProductResponse', CreateProductResponseSchema);
component('UpdateProductRequest', UpdateProductRequestSchema, {
  description:
    'Edit product content. The slug is not editable here — a rename is a deliberate separate action — and media is edited through the media endpoints.',
});
component('ProductStatusChangeRequest', ProductStatusChangeRequestSchema, {
  description:
    'Publish (active), unpublish (draft) or unlist (archived). Legal transitions are enforced by the product status machine; publishing needs an active variant.',
});
component('CreateVariantRequest', CreateVariantRequestSchema);
component('CreateVariantResponse', CreateVariantResponseSchema);
component('UpdateVariantRequest', UpdateVariantRequestSchema);
component('RegisterMediaRequest', RegisterMediaRequestSchema, {
  description:
    'Allocate an upload slot. The client uploads to the returned path via the Storage SDK; the declared content type is validated against the allowed set but re-derived authoritatively on finalize.',
});
component('RegisterMediaResponse', RegisterMediaResponseSchema);
component('InventoryAdjustRequest', InventoryAdjustRequestSchema, {
  description:
    'Adjust a variant’s stock at one warehouse by a signed delta. Only the operator-selectable reasons (adjustment, reconciliation) cross this wire; a manual adjustment requires a note.',
});
component('InventoryResponse', InventoryResponseSchema);
component('CreateCategoryRequest', CreateCategoryRequestSchema, {
  description:
    'Create a category. The slug is optional (derived from the name when absent) and becomes the URL identity; parentId is the parent slug or null. The tree is one level deep.',
});
component('CreateCategoryResponse', CreateCategoryResponseSchema);
component('UpdateCategoryRequest', UpdateCategoryRequestSchema, {
  description:
    'Edit a category. The slug is immutable — it is not on this contract; a rename changes the name. parentId may change, re-validated to keep the tree one level deep.',
});
component('ReorderCategoriesRequest', ReorderCategoriesRequestSchema);
component('AddCartItemRequest', AddCartItemRequestSchema, {
  description:
    'Add a variant to the cart or set its quantity. The server refreshes the price and availability and caps the quantity at the lower of stock and the per-line ceiling; the request never carries a price.',
});
component('UpdateCartRequest', UpdateCartRequestSchema);
component('CartView', CartViewSchema, {
  description:
    'The cart as rendered: lines with snapshots and a recomputed subtotal, gift-wrap, item count. All totals are display-only — the authoritative amount is the checkout quote.',
});

/** A `$ref` to a registered component. */
export function schemaRef(id: string): { readonly $ref: string } {
  return { $ref: `#/components/schemas/${id}` };
}

/**
 * Emits the component schemas.
 *
 * `io` matters for anything with a transform. `EmailSchema` accepts a mixed-case
 * address with whitespace on the way *in* and yields a trimmed lowercase one on the
 * way *out*, so the two directions are genuinely different documents. Components are
 * generated as `output` because that is what responses contain; request bodies are
 * described by `apps/api` from the same schemas with `io: 'input'`.
 */
export function buildComponentSchemas(io: 'input' | 'output' = 'output'): Record<string, unknown> {
  const { schemas } = z.toJSONSchema(contractRegistry, {
    target: 'draft-2020-12', // OpenAPI 3.1 is JSON Schema 2020-12.
    io,
    uri: (id) => `#/components/schemas/${id}`,
  });

  return schemas;
}

export type OpenApiPathItem = Readonly<Record<string, unknown>>;

export interface OpenApiDocumentOptions {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
  readonly servers?: readonly { readonly url: string; readonly description?: string }[];
  /** Paths, registered by `apps/api` as routes land. */
  readonly paths?: Readonly<Record<string, OpenApiPathItem>>;
}

export interface OpenApiDocument {
  readonly openapi: '3.1.0';
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description?: string;
  };
  readonly servers?: readonly { readonly url: string; readonly description?: string }[];
  readonly paths: Readonly<Record<string, OpenApiPathItem>>;
  readonly components: {
    readonly schemas: Record<string, unknown>;
    readonly securitySchemes: Record<string, unknown>;
  };
}

export function buildOpenApiDocument(options: OpenApiDocumentOptions): OpenApiDocument {
  return {
    openapi: '3.1.0',
    info: {
      title: options.title,
      version: options.version,
      ...(options.description === undefined ? {} : { description: options.description }),
    },
    ...(options.servers === undefined ? {} : { servers: options.servers }),
    paths: options.paths ?? {},
    components: {
      schemas: buildComponentSchemas('output'),
      securitySchemes: {
        firebaseIdToken: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Firebase ID token. Admin routes additionally require a role custom claim and verify token revocation on every request.',
        },
      },
    },
  };
}

export interface ErrorResponseObject {
  readonly description: string;
  readonly content: {
    readonly [PROBLEM_JSON_CONTENT_TYPE]: { readonly schema: { readonly $ref: string } };
  };
}

/**
 * Reusable `responses` entries for the error catalogue.
 *
 * Generated from `ERROR_DEFINITIONS`, so a code cannot be added to the taxonomy
 * without appearing in the specification.
 *
 * Note that OpenAPI keys responses by status, and four distinct codes share 409.
 * A route declaring several conflict codes therefore documents one 409 entry whose
 * description lists them; `code` in the body is what distinguishes them at runtime.
 */
export function errorResponses(codes: readonly ErrorCode[]): Record<string, ErrorResponseObject> {
  const byStatus = new Map<number, ErrorCode[]>();

  for (const code of codes) {
    const status = ERROR_DEFINITIONS[code].status;
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }

  const responses: Record<string, ErrorResponseObject> = {};
  for (const [status, statusCodes] of byStatus) {
    const described = statusCodes
      .map((code) => `\`${code}\` (${ERROR_DEFINITIONS[code].title}) — ${errorTypeUri(code)}`)
      .join('; ');

    responses[String(status)] = {
      description: described,
      content: { [PROBLEM_JSON_CONTENT_TYPE]: { schema: schemaRef('ProblemDetails') } },
    };
  }

  return responses;
}
