import { describe, expect, it } from 'vitest';

import {
  ModerationReviewViewSchema,
  OwnReviewViewSchema,
  PublicReviewViewSchema,
  ReviewRejectRequestSchema,
  ReviewSubmitRequestSchema,
} from './reviews';

/**
 * The review contracts. The concern is the boundary the routes rely on: a submission carries a valid
 * rating and non-empty text; the public view cannot carry the author's identity or moderation trail;
 * the author's view adds only the status; a rejection needs a reason.
 */

const validSubmit = {
  productId: 'wooden-blocks',
  rating: 4,
  title: 'Sturdy and well made',
  body: 'Held up to a month of daily play with no splinters.',
};

describe('ReviewSubmitRequestSchema', () => {
  it('accepts a well-formed submission', () => {
    expect(ReviewSubmitRequestSchema.safeParse(validSubmit).success).toBe(true);
  });

  it('trims the title and body and requires them', () => {
    expect(ReviewSubmitRequestSchema.safeParse({ ...validSubmit, title: '' }).success).toBe(false);
    expect(ReviewSubmitRequestSchema.safeParse({ ...validSubmit, body: '   ' }).success).toBe(
      false,
    );
    const parsed = ReviewSubmitRequestSchema.parse({ ...validSubmit, title: '  Great  ' });
    expect(parsed.title).toBe('Great');
  });

  it('rejects a rating outside 1–5 or a fractional one', () => {
    expect(ReviewSubmitRequestSchema.safeParse({ ...validSubmit, rating: 0 }).success).toBe(false);
    expect(ReviewSubmitRequestSchema.safeParse({ ...validSubmit, rating: 6 }).success).toBe(false);
    expect(ReviewSubmitRequestSchema.safeParse({ ...validSubmit, rating: 3.5 }).success).toBe(
      false,
    );
  });

  it('rejects a body over the length cap', () => {
    expect(
      ReviewSubmitRequestSchema.safeParse({ ...validSubmit, body: 'x'.repeat(4_001) }).success,
    ).toBe(false);
  });
});

const publicView = {
  id: 'review-1',
  productId: 'wooden-blocks',
  authorName: 'Asha M.',
  rating: 5,
  title: 'Lovely',
  body: 'Great toy.',
  verifiedPurchase: true,
  createdAt: new Date('2026-03-01T12:00:00.000Z'),
};

describe('PublicReviewViewSchema', () => {
  it('accepts a public review view', () => {
    expect(PublicReviewViewSchema.safeParse(publicView).success).toBe(true);
  });

  it('strips fields that would leak identity or the moderation trail', () => {
    const parsed = PublicReviewViewSchema.parse({
      ...publicView,
      userId: 'cust-1',
      status: 'published',
      rejectionReason: 'nope',
      moderatedBy: 'staff-1',
    });
    expect(parsed).not.toHaveProperty('userId');
    expect(parsed).not.toHaveProperty('status');
    expect(parsed).not.toHaveProperty('rejectionReason');
    expect(parsed).not.toHaveProperty('moderatedBy');
  });
});

describe('OwnReviewViewSchema', () => {
  it('adds the status so an author can see a pending review was received', () => {
    const parsed = OwnReviewViewSchema.parse({ ...publicView, status: 'pending' });
    expect(parsed.status).toBe('pending');
  });

  it('still does not carry the rejection reason', () => {
    const parsed = OwnReviewViewSchema.parse({
      ...publicView,
      status: 'rejected',
      rejectionReason: 'Off-topic',
    });
    expect(parsed).not.toHaveProperty('rejectionReason');
  });
});

describe('ModerationReviewViewSchema', () => {
  it('carries the author uid and verified-purchase evidence for a moderator', () => {
    const parsed = ModerationReviewViewSchema.parse({
      ...publicView,
      userId: 'cust-1',
      status: 'pending',
      orderId: 'order-1',
    });
    expect(parsed.userId).toBe('cust-1');
    expect(parsed.orderId).toBe('order-1');
  });

  it('allows a null order for an unverified review', () => {
    expect(
      ModerationReviewViewSchema.safeParse({
        ...publicView,
        userId: 'cust-1',
        status: 'pending',
        verifiedPurchase: false,
        orderId: null,
      }).success,
    ).toBe(true);
  });
});

describe('ReviewRejectRequestSchema', () => {
  it('requires a non-empty reason', () => {
    expect(ReviewRejectRequestSchema.safeParse({ reason: '' }).success).toBe(false);
    expect(ReviewRejectRequestSchema.safeParse({ reason: 'Off-topic' }).success).toBe(true);
  });
});
