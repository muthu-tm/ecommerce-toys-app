import { describe, expect, it } from 'vitest';

import { fulfilmentActions } from './fulfilment-actions';

/**
 * The fulfilment actions are derived from the state machine, so the UI cannot offer a move the API
 * would reject. `cancelled` is never offered — it has its own control with stock consequences.
 */

describe('fulfilmentActions', () => {
  it('offers pack, hold from unfulfilled — but never cancel', () => {
    const targets = fulfilmentActions('unfulfilled').map((action) => action.to);
    expect(targets).toContain('packed');
    expect(targets).toContain('on_hold');
    expect(targets).not.toContain('cancelled');
  });

  it('offers ship and hold from packed', () => {
    const targets = fulfilmentActions('packed').map((action) => action.to);
    expect(targets).toContain('shipped');
    expect(targets).toContain('on_hold');
  });

  it('offers only deliver and hold from shipped, never back to packed', () => {
    const targets = fulfilmentActions('shipped').map((action) => action.to);
    expect(targets).toEqual(expect.arrayContaining(['delivered', 'on_hold']));
    expect(targets).not.toContain('packed');
  });

  it('offers nothing from a delivered order', () => {
    expect(fulfilmentActions('delivered')).toEqual([]);
  });

  it('labels the ship action clearly', () => {
    const ship = fulfilmentActions('packed').find((action) => action.to === 'shipped');
    expect(ship?.label).toBe('Mark shipped');
  });
});
