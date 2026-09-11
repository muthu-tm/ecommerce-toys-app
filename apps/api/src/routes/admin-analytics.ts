import type { DailyAnalyticsResponse } from '@romp/contracts';
import { DailyAnalyticsRangeRequestSchema } from '@romp/contracts';
import { listDailyAnalytics } from '@romp/data';
import { parseOrThrow } from '@romp/observability';

import type { RompApp } from '../app';
import { requireAdminHook } from '../plugins/auth';
import { requireOperator } from '../request-context';

/**
 * The admin analytics route — the dashboard's read of the pre-computed daily rollups.
 *
 * A range in, the rollup rows for it out, oldest first. The rows are written by the scheduled
 * `analyticsDailyRollup` function (`functions.ts`), so this handler never scans `orders` — it reads a
 * bounded set of small documents, which is the whole point of the rollup (`DATA_MODEL.md`). Revenue
 * is staff-only, and the repository enforces that; the route only translates the query.
 */
export function registerAdminAnalyticsRoutes(app: RompApp): void {
  const { context } = app.deps;

  app.get('/v1/admin/analytics/daily', { preHandler: requireAdminHook }, async (request, reply) => {
    const operator = requireOperator(request);
    const range = parseOrThrow(DailyAnalyticsRangeRequestSchema, request.query);

    const days = await listDailyAnalytics(context, operator, { from: range.from, to: range.to });

    const response: DailyAnalyticsResponse = {
      days: days.map((day) => ({ ...day })),
    };
    return reply.send(response);
  });
}
