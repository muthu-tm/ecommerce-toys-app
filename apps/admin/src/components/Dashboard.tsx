import type { DailyAnalyticsDoc, Money } from '@romp/contracts';
import { Card, PageHeader, Stat } from '@romp/ui';


import { formatMoney, locale, moneyFormat } from '@/lib/store';

/**
 * The backoffice dashboard.
 *
 * Reads the pre-computed daily rollups for a range and shows the headline totals plus a per-day
 * table — revenue, orders, paid orders and average order value. It never scans `orders`: the numbers
 * are the rollup documents the scheduled job writes, so the page cost is the range, not the order
 * volume. A day with no rollup simply does not appear.
 */
export function Dashboard({
  days,
  from,
  to,
}: {
  readonly days: readonly DailyAnalyticsDoc[];
  readonly from: string;
  readonly to: string;
}) {
  const totalRevenue = sum(days.map((day) => day.revenueMinor));
  const totalOrders = days.reduce((count, day) => count + day.orderCount, 0);
  const totalPaid = days.reduce((count, day) => count + day.paidCount, 0);
  const totalRefunded = sum(days.map((day) => day.refundedMinor));

  const dateFormat = new Intl.DateTimeFormat(locale.locale, {
    dateStyle: 'medium',
    timeZone: locale.timezone,
  });
  const formatDay = (date: string): string => {
    const parsed = new Date(`${date}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? date : dateFormat.format(parsed);
  };

  return (
    <section aria-labelledby="dashboard-heading" className="flex flex-col gap-6">
      <PageHeader
        title={<span id="dashboard-heading">Overview</span>}
        description={`${from} to ${to}`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Revenue" value={formatMoney(totalRevenue, moneyFormat)} tone="success" />
        <Stat label="Orders" value={String(totalOrders)} />
        <Stat label="Paid orders" value={String(totalPaid)} />
        <Stat
          label="Refunded"
          value={formatMoney(totalRefunded, moneyFormat)}
          tone={totalRefunded > 0 ? 'danger' : 'default'}
        />
      </div>

      {days.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-body text-text-muted">No sales data for this range yet.</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full border-collapse">
            <caption className="sr-only">Daily sales</caption>
            <thead>
              <tr className="border-b border-border bg-surface-alt text-left">
                <Th>Date</Th>
                <Th>Orders</Th>
                <Th>Paid</Th>
                <Th>Revenue</Th>
                <Th>Avg order</Th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date} className="border-b border-border last:border-0">
                  <Td>{formatDay(day.date)}</Td>
                  <Td>{day.orderCount}</Td>
                  <Td>{day.paidCount}</Td>
                  <Td>{formatMoney(day.revenueMinor, moneyFormat)}</Td>
                  <Td>{formatMoney(day.aovMinor, moneyFormat)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}

function Th({ children }: { readonly children: React.ReactNode }) {
  return <th className="px-4 py-2 font-body text-sm font-semibold text-text-muted">{children}</th>;
}

function Td({ children }: { readonly children: React.ReactNode }) {
  return <td className="px-4 py-2 font-body text-sm text-text-primary">{children}</td>;
}

/** Sums a list of money values as an integer paise total. */
function sum(values: readonly Money[]): Money {
  return values.reduce((total, value) => total + value, 0) as Money;
}
