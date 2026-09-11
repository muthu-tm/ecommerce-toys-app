import { describe, expect, it } from 'vitest';

import { formatBadge, groupByDay } from './notifications-view';
import type { FeedNotification } from './use-notifications';

const LABELS = { today: 'Today', yesterday: 'Yesterday', earlier: 'Earlier' };
const NOW = new Date('2026-03-15T14:00:00');

function note(id: string, createdAt: Date | null): FeedNotification {
  return { id, title: id, body: '', link: '/', createdAt, read: false };
}

describe('formatBadge', () => {
  it('returns null for zero unread', () => {
    expect(formatBadge(0)).toBeNull();
  });

  it('returns the number for 1..9', () => {
    expect(formatBadge(1)).toBe('1');
    expect(formatBadge(9)).toBe('9');
  });

  it('caps at 9+ beyond nine', () => {
    expect(formatBadge(10)).toBe('9+');
    expect(formatBadge(250)).toBe('9+');
  });
});

describe('groupByDay', () => {
  it('buckets by calendar day, not a rolling 24 hours', () => {
    const groups = groupByDay(
      [
        note('today-morning', new Date('2026-03-15T08:00:00')),
        note('yesterday-late', new Date('2026-03-14T23:30:00')),
        note('last-week', new Date('2026-03-08T10:00:00')),
      ],
      LABELS,
      NOW,
    );

    expect(groups.map((g) => g.bucket)).toEqual(['today', 'yesterday', 'earlier']);
    expect(groups[0]?.items[0]?.id).toBe('today-morning');
    expect(groups[1]?.items[0]?.id).toBe('yesterday-late');
    expect(groups[2]?.items[0]?.id).toBe('last-week');
  });

  it('omits empty buckets', () => {
    const groups = groupByDay([note('t', new Date('2026-03-15T09:00:00'))], LABELS, NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.bucket).toBe('today');
  });

  it('treats a null timestamp as today (just arrived)', () => {
    const groups = groupByDay([note('pending', null)], LABELS, NOW);
    expect(groups[0]?.bucket).toBe('today');
  });

  it('handles a month boundary — the 1st sees the previous month last day as yesterday', () => {
    const firstOfMonth = new Date('2026-04-01T10:00:00');
    const groups = groupByDay(
      [note('mar31', new Date('2026-03-31T22:00:00'))],
      LABELS,
      firstOfMonth,
    );
    expect(groups[0]?.bucket).toBe('yesterday');
  });

  it('preserves input order within a bucket', () => {
    const groups = groupByDay(
      [
        note('first', new Date('2026-03-15T12:00:00')),
        note('second', new Date('2026-03-15T09:00:00')),
      ],
      LABELS,
      NOW,
    );
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['first', 'second']);
  });
});
