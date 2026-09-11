import type { FulfilmentStatus } from '@romp/contracts';
import { fulfilmentStatusMachine } from '@romp/contracts';

import { fulfilmentStatusLabel } from './order-view';

/**
 * The fulfilment actions offered from a given stage.
 *
 * Derived from the same state machine the server enforces, so the UI cannot offer a move the API
 * would reject — a shipped order shows "Mark delivered" and "Put on hold", never "Pack". `cancelled`
 * is deliberately excluded: cancelling has stock consequences (release or restock) and its own
 * control, so it is not a fulfilment step. The label is the target stage's own label as a verb-ish
 * affordance ("Mark packed", "Mark shipped").
 */
export interface FulfilmentAction {
  readonly to: FulfilmentStatus;
  readonly label: string;
}

/** Whether packing is even offered depends on payment; the caller gates that. This is stage-legal only. */
export function fulfilmentActions(status: FulfilmentStatus): readonly FulfilmentAction[] {
  return fulfilmentStatusMachine
    .nextStates(status)
    .filter((next) => next !== 'cancelled')
    .map((next) => ({ to: next, label: actionLabel(next) }));
}

function actionLabel(status: FulfilmentStatus): string {
  switch (status) {
    case 'unfulfilled':
      return 'Take off hold';
    case 'on_hold':
      return 'Put on hold';
    case 'packed':
    case 'shipped':
    case 'delivered':
    case 'cancelled':
      return `Mark ${fulfilmentStatusLabel(status).toLowerCase()}`;
  }
}
