'use client';

import Link from 'next/link';
import { useId, useState } from 'react';

import type { ReviewSubmitRequest } from '@romp/contracts';
import { RatingSchema } from '@romp/contracts';
import { Button, Field } from '@romp/ui';

import { AccountApiError, accountApi } from '@/lib/account-api';
import { useAuth } from '@/lib/auth-context';
import { content } from '@/lib/store';

/**
 * The review submission form — a client island on the product page.
 *
 * Auth-gated: a signed-out visitor sees a prompt to sign in (the review routes require a token), and
 * a signed-in customer sees the form. On submit it posts to `/v1/reviews`; the review is held
 * `pending` server-side, so success shows the moderation notice rather than the review appearing.
 * A duplicate (one review per product) surfaces the server's own message. The rating is a 1–5 select
 * and the body a textarea — both labelled with the shared focus treatment, so the form is keyboard-
 * and screen-reader-navigable.
 */
export function ReviewForm({ productId }: { readonly productId: string }) {
  const copy = content.product.reviews;
  const { uid, ready } = useAuth();

  const ratingId = useId();
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Wait for the SDK to resolve who is signed in before choosing which surface to show, so the
  // form does not flash for a signed-out visitor.
  if (!ready) return null;

  if (uid === null) {
    return (
      <p className="font-body text-sm text-text-muted">
        <Link href={`/account?next=/`} className="text-accent underline">
          {copy.signInPrompt}
        </Link>
      </p>
    );
  }

  if (done) {
    return (
      <p role="status" className="font-body text-sm text-text-secondary">
        {copy.pendingNotice}
      </p>
    );
  }

  const submit = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    setPending(true);
    setError(null);
    void accountApi
      .submitReview({
        productId: productId as ReviewSubmitRequest['productId'],
        rating: RatingSchema.parse(rating),
        title,
        body,
      })
      .then(() => {
        setDone(true);
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof AccountApiError
            ? cause.message
            : 'Could not post your review. Try again.',
        );
      })
      .finally(() => {
        setPending(false);
      });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label={copy.writeCta}>
      <div className="flex flex-col gap-1">
        <label htmlFor={ratingId} className="font-body text-sm text-text-secondary">
          {copy.ratingLabel}
        </label>
        <select
          id={ratingId}
          value={rating}
          onChange={(event) => {
            setRating(Number(event.target.value));
          }}
          className="rounded-md border border-border bg-surface px-3 py-2 font-body text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {[5, 4, 3, 2, 1].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      <Field
        label={copy.titleLabel}
        type="text"
        value={title}
        maxLength={120}
        onChange={(event) => {
          setTitle(event.target.value);
        }}
        required
      />

      <label className="flex flex-col gap-1">
        <span className="font-body text-sm text-text-secondary">{copy.bodyLabel}</span>
        <textarea
          value={body}
          maxLength={4000}
          rows={4}
          onChange={(event) => {
            setBody(event.target.value);
          }}
          required
          className="rounded-md border border-border bg-surface px-3 py-2 font-body text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        />
      </label>

      {error !== null ? (
        <p role="alert" className="font-body text-sm text-danger">
          {error}
        </p>
      ) : null}

      <Button type="submit" loading={pending} disabled={pending}>
        {copy.submitLabel}
      </Button>
    </form>
  );
}
