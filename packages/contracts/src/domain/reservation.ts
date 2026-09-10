import { z } from 'zod';

import { createStateMachine } from '../state-machine';

/**
 * Stock reservation lifecycle.
 *
 * A reservation is the mechanism that lets a customer pay by manual UPI transfer
 * without the stock being sold underneath them. It holds units without moving them:
 * `available = onHandTotal - reserved`.
 *
 * The invariant that matters operationally is that **no reservation stays `active`
 * past `expiresAt`**. The sweeper guarantees it, and the sweeper's
 * *non-execution* — not its error rate — is the alerting condition, because a
 * sweeper that has stopped throws nothing while stock leaks indefinitely.
 */
export const ReservationStatusSchema = z.enum([
  /** Holding stock. Counts towards `inventory.reserved`. */
  'active',
  /** Payment verified; the held units have been decremented from on-hand stock. */
  'committed',
  /** Returned to available, whether by expiry, cancellation or payment rejection. */
  'released',
]);
export type ReservationStatus = z.infer<typeof ReservationStatusSchema>;

/** Both outcomes are terminal: a released reservation is not reused, a new one is created. */
export const reservationStatusMachine = createStateMachine('reservation status', {
  active: ['committed', 'released'],
  committed: [],
  released: [],
} satisfies Record<ReservationStatus, readonly ReservationStatus[]>);
