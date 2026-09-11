import { describe, expect, it } from 'vitest';

import { SubmitPaymentProofRequestSchema, SubmitPaymentProofResponseSchema } from './payments';

/**
 * The payment-proof contracts. The concern is the boundary the route relies on: the request carries
 * a raw reference (the server normalises, so the wire is deliberately lenient) and an optional proof
 * path — never an amount — and the response only confirms the state moved.
 */

describe('SubmitPaymentProofRequestSchema', () => {
  it('accepts a reference with an optional proof path', () => {
    expect(
      SubmitPaymentProofRequestSchema.safeParse({
        upiRef: '4123 9876 5432',
        screenshotPath: 'payment-proofs/order-1/user-1/proof.jpg',
      }).success,
    ).toBe(true);
  });

  it('accepts a reference-only submission', () => {
    expect(
      SubmitPaymentProofRequestSchema.safeParse({ upiRef: '412398765432', screenshotPath: null })
        .success,
    ).toBe(true);
  });

  it('rejects a missing reference', () => {
    expect(SubmitPaymentProofRequestSchema.safeParse({ screenshotPath: null }).success).toBe(false);
  });

  it('rejects an empty reference', () => {
    expect(
      SubmitPaymentProofRequestSchema.safeParse({ upiRef: '', screenshotPath: null }).success,
    ).toBe(false);
  });

  it('ignores an amount the client tries to dictate', () => {
    const result = SubmitPaymentProofRequestSchema.safeParse({
      upiRef: '412398765432',
      screenshotPath: null,
      amountMinor: 1,
    });
    expect(result.success).toBe(true);
    if (result.success) expect('amountMinor' in result.data).toBe(false);
  });
});

describe('SubmitPaymentProofResponseSchema', () => {
  it('accepts a pending-verification confirmation', () => {
    expect(
      SubmitPaymentProofResponseSchema.safeParse({
        orderId: 'order-1',
        status: 'pending_verification',
        submittedAt: new Date('2026-09-09T00:00:00.000Z'),
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(
      SubmitPaymentProofResponseSchema.safeParse({
        orderId: 'order-1',
        status: 'not_a_status',
        submittedAt: new Date(),
      }).success,
    ).toBe(false);
  });
});
