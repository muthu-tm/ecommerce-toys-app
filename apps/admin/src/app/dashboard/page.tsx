import { Dashboard } from '@/components/Dashboard';
import { locale } from '@/lib/store';
import { getDailyAnalytics } from '@/server/orders';

/**
 * The backoffice dashboard.
 *
 * A server component reading the pre-computed daily rollups for a range as a staff caller. The
 * default range is the last 30 store-local days; a `from`/`to` query overrides it. Dynamic — the
 * rollup is written daily, and a staff member reloading expects the latest.
 */
export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const to = validDate(params.to) ?? storeLocalDate(new Date(), locale.timezone, 0);
  const from = validDate(params.from) ?? storeLocalDate(new Date(), locale.timezone, 29);
  const range = from <= to ? { from, to } : { from: to, to: from };

  const days = await getDailyAnalytics(range);
  return <Dashboard days={days} from={range.from} to={range.to} />;
}

/** A `yyyy-mm-dd` query value, or undefined. */
function validDate(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : undefined;
}

/** The `yyyy-mm-dd` of the store-local day `daysAgo` days before an instant. */
function storeLocalDate(instant: Date, timeZone: string, daysAgo: number): string {
  const shifted = new Date(instant.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(shifted);
}
