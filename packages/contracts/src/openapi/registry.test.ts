import { describe, expect, it } from 'vitest';

import { OrderStatusSchema } from '../domain/order';
import { EventTypeSchema } from '../events';
import { ErrorCodeSchema } from '../http/error-codes';

import { buildComponentSchemas, buildOpenApiDocument, errorResponses, schemaRef } from './registry';

/**
 * These tests are why the specification can be trusted: they assert on a real
 * generated document rather than on the registry's inputs. Branded and transformed
 * schemas are the two places a schema-to-JSON-Schema emitter usually needs help,
 * so both are checked explicitly.
 */
describe('buildOpenApiDocument', () => {
  const document = buildOpenApiDocument({
    title: 'ROMP API',
    version: '1.0.0',
    description: 'Test build',
    servers: [{ url: 'https://api.example.com', description: 'prod' }],
  });
  const schemas = document.components.schemas as Record<string, Record<string, unknown>>;

  it('generates a 3.1 document with the given info and servers', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.info).toMatchObject({ title: 'ROMP API', version: '1.0.0' });
    expect(document.servers?.[0]?.url).toBe('https://api.example.com');
    expect(document.paths).toEqual({});
  });

  it('emits Money as a non-negative integer, never a number', () => {
    // If this ever emits `type: "number"`, a generated client will happily send
    // 1699.99 and the contract has stopped protecting the money path.
    expect(schemas.Money).toMatchObject({ type: 'integer', minimum: 0 });
    expect(schemas.Money?.type).not.toBe('number');
  });

  it('emits BasisPoints bounded to 0–10000', () => {
    expect(schemas.BasisPoints).toMatchObject({
      type: 'integer',
      minimum: 0,
      maximum: 10_000,
    });
  });

  it('resolves branded schemas to their underlying type', () => {
    // Brands are type-level only; they must not leak into the wire contract.
    expect(schemas.Quantity).toMatchObject({ type: 'integer', minimum: 0 });
    expect(schemas.Slug).toMatchObject({ type: 'string' });
  });

  it('resolves normalising schemas to their output type', () => {
    // Email, Sku and Utr each pipe through a transform. The output side is what a
    // response contains, and it is stricter than the input side.
    for (const name of ['Email', 'Sku', 'Utr']) {
      expect(schemas[name], name).toMatchObject({ type: 'string' });
    }
    expect(schemas.Email?.format).toBe('email');
    expect(schemas.Utr?.maxLength).toBe(64);
  });

  it('describes the input side differently where a transform loosens it', () => {
    const input = buildComponentSchemas('input') as Record<string, Record<string, unknown>>;

    // Utr accepts up to 128 characters in, because whitespace is stripped before
    // the 64-character bound applies. Emitting one direction for both would
    // document a request constraint that does not exist.
    expect(input.Utr?.maxLength).toBe(128);
  });

  it('emits every enum with its full member list', () => {
    expect(schemas.OrderStatus).toMatchObject({
      type: 'string',
      enum: [...OrderStatusSchema.options],
    });
    expect(schemas.EventType).toMatchObject({ enum: [...EventTypeSchema.options] });
    expect(schemas.ErrorCode).toMatchObject({ enum: [...ErrorCodeSchema.options] });
  });

  it('emits the problem document with code required and detail optional', () => {
    const problem = schemas.ProblemDetails as {
      required?: string[];
      properties?: Record<string, unknown>;
    };

    expect(problem.required).toContain('code');
    expect(problem.required).toContain('status');
    // An INTERNAL response carries no detail, so it cannot be required.
    expect(problem.required).not.toContain('detail');
    expect(problem.properties?.errors).toBeDefined();
  });

  it('references shared components rather than inlining them', () => {
    const problem = schemas.ProblemDetails as {
      properties?: Record<string, Record<string, unknown>>;
    };

    expect(problem.properties?.code?.$ref).toBe('#/components/schemas/ErrorCode');
  });

  it('declares bearer authentication', () => {
    expect(document.components.securitySchemes.firebaseIdToken).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('accepts paths supplied by the API app', () => {
    const withRoute = buildOpenApiDocument({
      title: 'ROMP API',
      version: '1.0.0',
      paths: {
        '/v1/health': {
          get: {
            summary: 'Liveness',
            responses: { '200': { description: 'Healthy' }, ...errorResponses(['INTERNAL']) },
          },
        },
      },
    });

    expect(withRoute.paths['/v1/health']).toBeDefined();
    expect(JSON.stringify(withRoute.paths['/v1/health'])).toContain(
      '#/components/schemas/ProblemDetails',
    );
  });

  it('produces JSON-serialisable output', () => {
    // The document gets written to a file and served; a non-serialisable value
    // would only fail at that point.
    expect(() => JSON.stringify(document)).not.toThrow();
  });

  it('registers a component for every error code and enum the API exposes', () => {
    for (const name of [
      'Money',
      'BasisPoints',
      'Cursor',
      'Email',
      'E164Phone',
      'Sku',
      'Slug',
      'Pincode',
      'AgeBand',
      'HumanOrderId',
      'Utr',
      'UpiVpa',
      'OrderStatus',
      'FulfilmentStatus',
      'PaymentMethod',
      'DeliverySpeed',
      'ProductStatus',
      'ReservationStatus',
      'ReviewStatus',
      'Rating',
      'RefundMode',
      'RefundReason',
      'InventoryLedgerReason',
      'EventType',
      'NotificationType',
      'Audience',
      'ErrorCode',
      'ValidationIssue',
      'ProblemDetails',
    ]) {
      expect(schemas[name], `${name} is not registered as a component`).toBeDefined();
    }
  });
});

describe('schemaRef', () => {
  it('builds a components reference', () => {
    expect(schemaRef('Money')).toEqual({ $ref: '#/components/schemas/Money' });
  });
});

describe('errorResponses', () => {
  it('builds a problem+json response per status, from the catalogue', () => {
    const responses = errorResponses(['NOT_FOUND', 'INSUFFICIENT_STOCK']);

    expect(Object.keys(responses).sort()).toEqual(['404', '409']);
    expect(responses['404']?.description).toContain('NOT_FOUND');
    expect(responses['409']?.content['application/problem+json']?.schema).toEqual(
      schemaRef('ProblemDetails'),
    );
  });

  it('groups codes that share a status and names all of them', () => {
    // Four distinct 409s exist. OpenAPI keys responses by status, so they collapse
    // into one entry — and the description has to say which codes it covers, or the
    // spec would silently document only one of them.
    const responses = errorResponses([
      'INSUFFICIENT_STOCK',
      'DUPLICATE_PAYMENT_REFERENCE',
      'INVALID_STATE_TRANSITION',
    ]);

    expect(Object.keys(responses)).toEqual(['409']);
    expect(responses['409']?.description).toContain('INSUFFICIENT_STOCK');
    expect(responses['409']?.description).toContain('DUPLICATE_PAYMENT_REFERENCE');
    expect(responses['409']?.description).toContain('INVALID_STATE_TRANSITION');
  });

  it('returns nothing for an empty code list', () => {
    expect(errorResponses([])).toEqual({});
  });
});
