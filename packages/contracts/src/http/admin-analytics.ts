import { z } from 'zod';

import { DailyAnalyticsDocSchema } from '../entities/settings';

/**
 * The admin analytics wire contracts.
 *
 * The dashboard reads pre-computed daily rollups, never a live scan of `orders` (`DATA_MODEL.md`).
 * The request is a date range; the response is the rollup rows for the dates in it that exist. A row
 * is exactly the stored `DailyAnalyticsDoc` — the dashboard charts revenue, order counts and AOV
 * straight from it — so there is no separate view schema to keep in step.
 */

const RollupDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'A rollup date is yyyy-mm-dd.' });

/**
 * The date range the dashboard charts.
 *
 * Both ends inclusive — "the last 30 days" means those 30 dates — and `from` must not be after `to`,
 * which is a caller error a 400 explains rather than an empty chart with no reason. The dates are
 * `yyyy-mm-dd` in the store's timezone, the same form the rollup documents are keyed by.
 */
export const DailyAnalyticsRangeRequestSchema = z
  .object({
    from: RollupDateSchema,
    to: RollupDateSchema,
  })
  .refine((range) => range.from <= range.to, {
    error: 'The range start must not be after its end.',
    path: ['from'],
  });
export type DailyAnalyticsRangeRequest = z.infer<typeof DailyAnalyticsRangeRequestSchema>;

/** A single day's rollup as the dashboard reads it — the stored document, unmodified. */
export const DailyAnalyticsRowSchema = DailyAnalyticsDocSchema;
export type DailyAnalyticsRow = z.infer<typeof DailyAnalyticsRowSchema>;

/** The rollup rows for the requested range, oldest first. Missing days simply do not appear. */
export const DailyAnalyticsResponseSchema = z.object({
  days: z.array(DailyAnalyticsRowSchema),
});
export type DailyAnalyticsResponse = z.infer<typeof DailyAnalyticsResponseSchema>;
