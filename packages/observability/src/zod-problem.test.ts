import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MoneySchema, SkuSchema } from '@romp/contracts';

import { ValidationFailedError, toProblemDetails } from './errors';
import { parseOrThrow, validationErrorFromZod, zodIssuesToValidationIssues } from './zod-problem';

const CartBody = z.object({
  items: z.array(z.object({ sku: SkuSchema, qty: z.int().positive() })).min(1),
  giftWrap: z.boolean(),
});

describe('zodIssuesToValidationIssues', () => {
  it('produces dotted paths with array indices inline', () => {
    // Clients map these straight onto form field names, which is why it is not a
    // JSON Pointer.
    const result = CartBody.safeParse({ items: [{ sku: 'OK-1', qty: 0 }], giftWrap: true });
    if (result.success) throw new Error('expected a failure');

    const issues = zodIssuesToValidationIssues(result.error);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('items.0.qty');
    expect(issues[0]?.message.length).toBeGreaterThan(0);
  });

  it('names a root-level failure rather than emitting an empty path', () => {
    // An empty string would render as a blank field name in a form.
    const result = CartBody.safeParse('not an object');
    if (result.success) throw new Error('expected a failure');

    expect(zodIssuesToValidationIssues(result.error)[0]?.path).toBe('(root)');
  });

  it('reports every failing field, not just the first', () => {
    const result = CartBody.safeParse({ items: [], giftWrap: 'yes' });
    if (result.success) throw new Error('expected a failure');

    const paths = zodIssuesToValidationIssues(result.error).map((issue) => issue.path);
    expect(paths).toContain('items');
    expect(paths).toContain('giftWrap');
  });

  it('carries our own schema messages through', () => {
    const result = MoneySchema.safeParse(1699.99);
    if (result.success) throw new Error('expected a failure');

    expect(zodIssuesToValidationIssues(result.error)[0]?.message).toMatch(
      /integer number of paise/,
    );
  });
});

describe('validationErrorFromZod', () => {
  it('produces a 400 problem document with field detail', () => {
    const result = CartBody.safeParse({ items: [{ sku: 'OK-1', qty: -1 }], giftWrap: true });
    if (result.success) throw new Error('expected a failure');

    const problem = toProblemDetails(validationErrorFromZod(result.error), 'req-1');

    expect(problem).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', requestId: 'req-1' });
    expect(problem.errors?.[0]?.path).toBe('items.0.qty');
  });

  it('accepts an overriding detail message', () => {
    const result = CartBody.safeParse({});
    if (result.success) throw new Error('expected a failure');

    expect(validationErrorFromZod(result.error, 'Check your cart.').detail).toBe(
      'Check your cart.',
    );
  });
});

describe('parseOrThrow', () => {
  it('returns the parsed output, normalisation included', () => {
    const parsed = parseOrThrow(CartBody, {
      items: [{ sku: ' brk-2401 ', qty: 2 }],
      giftWrap: false,
    });

    // The SKU came back normalised, which is the point of parsing at the boundary
    // rather than validating and then using the raw input.
    expect(parsed.items[0]?.sku).toBe('BRK-2401');
  });

  it('throws ValidationFailedError with usable paths', () => {
    let thrown: unknown;
    try {
      parseOrThrow(CartBody, { items: [{ sku: 'OK-1', qty: 'two' }], giftWrap: false });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ValidationFailedError);
    expect((thrown as ValidationFailedError).issues[0]?.path).toBe('items.0.qty');
  });

  it('strips unknown keys rather than accepting them', () => {
    // An over-supplied payload must not smuggle fields past the contract.
    const parsed = parseOrThrow(CartBody, {
      items: [{ sku: 'OK-1', qty: 1 }],
      giftWrap: false,
      isAdmin: true,
    }) as Record<string, unknown>;

    expect(parsed.isAdmin).toBeUndefined();
  });
});
