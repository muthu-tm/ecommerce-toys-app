import type { ReactNode } from 'react';

import { cn } from './cn';

export type StatTone = 'default' | 'accent' | 'success' | 'warning' | 'danger';

const VALUE_TONE: Readonly<Record<StatTone, string>> = Object.freeze({
  default: 'text-text-primary',
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
});

export interface StatProps {
  /** The metric label, e.g. "Revenue" or "Paid orders". */
  readonly label: string;
  /** The metric value. A string or number for the common case; a node for rich values. */
  readonly value: ReactNode;
  /** Optional secondary line under the value — a delta, a period, a hint. */
  readonly hint?: ReactNode;
  readonly tone?: StatTone;
  readonly className?: string;
}

/**
 * A single metric tile for a dashboard.
 *
 * A raised card with the label above and the value below in the display face. The value
 * carries the visual weight; the label is muted and small. Tone colours only the value,
 * never the whole tile — a coloured fill would need its own on-colour token to stay
 * contrast-gated, whereas coloured text on the neutral surface is already covered.
 *
 * The label/value order in the DOM is label-first so a screen reader reads "Revenue,
 * ₹1,20,000" rather than the value stranded from its meaning.
 */
export function Stat({ label, value, hint, tone = 'default', className }: StatProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg border border-border bg-surface-elevated p-4 shadow-card',
        className,
      )}
    >
      <span className="font-body text-sm font-semibold text-text-muted">{label}</span>
      <span className={cn('font-display text-2xl', VALUE_TONE[tone])}>{value}</span>
      {hint === undefined ? null : (
        <span className="font-body text-sm text-text-secondary">{hint}</span>
      )}
    </div>
  );
}
