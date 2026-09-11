import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { DailyAnalyticsDoc } from '@romp/contracts';
import { dailyAnalytics } from '@romp/contracts/fixtures';

import { Dashboard } from './Dashboard';

/**
 * The dashboard totals the rollup rows and lists them per day. The empty state is a plain affordance.
 */

describe('Dashboard', () => {
  it('shows an empty state for a range with no data', () => {
    render(<Dashboard days={[]} from="2026-03-01" to="2026-03-31" />);
    expect(screen.getByText(/no sales data/iu)).toBeInTheDocument();
  });

  it('renders the headline metrics and a per-day row', () => {
    const day: DailyAnalyticsDoc = dailyAnalytics({
      date: '2026-03-01',
      orderCount: 3,
      paidCount: 2,
    });
    render(<Dashboard days={[day]} from="2026-03-01" to="2026-03-31" />);

    // "Revenue" appears both as a headline metric and a column header, so assert each by role.
    expect(screen.getByRole('columnheader', { name: 'Revenue' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Paid' })).toBeInTheDocument();
    // The headline metrics tile the totals.
    expect(screen.getByText('Paid orders')).toBeInTheDocument();
  });

  it('sums revenue across days', () => {
    render(
      <Dashboard
        days={[dailyAnalytics({ date: '2026-03-01' }), dailyAnalytics({ date: '2026-03-02' })]}
        from="2026-03-01"
        to="2026-03-02"
      />,
    );
    // Two rows in the table body.
    const rows = screen.getAllByRole('row');
    // One header row + two data rows.
    expect(rows.length).toBe(3);
  });
});
