/**
 * A static star-rating display.
 *
 * Renders five glyphs — filled up to `rating`, hollow after — with a single accessible name so a
 * screen reader announces "4 out of 5 stars" rather than reading five separate characters. The stars
 * themselves are `aria-hidden`; the label carries the meaning. No client JavaScript: this is a
 * server-rendered read-only display, used in the review list and the summary line.
 */
export interface StarRatingProps {
  /** The rating to show, 1–5 (rounded to the nearest whole star for the glyphs). */
  readonly rating: number;
  /** The accessible label, e.g. "4 out of 5 stars". */
  readonly label: string;
}

export function StarRating({ rating, label }: StarRatingProps) {
  const filled = Math.round(rating);
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((star) => (
        <span
          key={star}
          aria-hidden="true"
          className={star <= filled ? 'text-accent' : 'text-text-muted/40'}
        >
          {star <= filled ? '★' : '☆'}
        </span>
      ))}
    </span>
  );
}
