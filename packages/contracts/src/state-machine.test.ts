import { describe, expect, it } from 'vitest';

import { fulfilmentStatusMachine, orderStatusMachine } from './domain/order';
import type { FulfilmentStatus, OrderStatus } from './domain/order';
import { productStatusMachine } from './domain/product';
import { reservationStatusMachine } from './domain/reservation';
import { reviewStatusMachine } from './domain/review';
import { createStateMachine, describeTransitionFailure } from './state-machine';

describe('createStateMachine', () => {
  it('derives states and terminal states from the table', () => {
    const machine = createStateMachine('test', { a: ['b'], b: ['c'], c: [] });

    expect(machine.states).toEqual(['a', 'b', 'c']);
    expect(machine.terminalStates).toEqual(['c']);
    expect(machine.isTerminal('c')).toBe(true);
    expect(machine.isTerminal('a')).toBe(false);
    expect(machine.nextStates('b')).toEqual(['c']);
  });

  it('rejects a table pointing at an undeclared state', () => {
    // Otherwise the typo surfaces much later, in whichever path attempts it first.
    expect(() => createStateMachine('test', { a: ['typo'] } as never)).toThrow(
      /not a declared state/,
    );
  });

  it('rejects a self-transition', () => {
    expect(() => createStateMachine('test', { a: ['a'] })).toThrow(/transition to itself/);
  });

  it('reports why a transition was refused', () => {
    const machine = createStateMachine('test', { a: ['b'], b: [] });

    expect(machine.check('a', 'b')).toEqual({ ok: true });
    expect(machine.check('nope', 'b')).toMatchObject({ ok: false, reason: 'unknown_from' });
    expect(machine.check('a', 'nope')).toMatchObject({ ok: false, reason: 'unknown_to' });
    expect(machine.check('b', 'a')).toMatchObject({
      ok: false,
      reason: 'illegal_transition',
      allowed: [],
    });
  });

  it('narrows an arbitrary string with isState', () => {
    const machine = createStateMachine('test', { a: ['b'], b: [] });

    expect(machine.isState('a')).toBe(true);
    expect(machine.isState('z')).toBe(false);
  });

  it('is frozen, so a table cannot be edited at runtime', () => {
    const machine = createStateMachine('test', { a: ['b'], b: [] });

    expect(Object.isFrozen(machine)).toBe(true);
  });
});

describe('describeTransitionFailure', () => {
  const machine = createStateMachine('test', { a: ['b'], b: [] });

  it('explains each rejection reason', () => {
    const unknownFrom = machine.check('zzz', 'b');
    const unknownTo = machine.check('a', 'zzz');
    const illegal = machine.check('b', 'a');

    if (unknownFrom.ok || unknownTo.ok || illegal.ok) throw new Error('expected failures');

    expect(describeTransitionFailure('test', unknownFrom)).toMatch(/not a known state/);
    expect(describeTransitionFailure('test', unknownTo)).toMatch(/not a known state/);
    expect(describeTransitionFailure('test', illegal)).toMatch(/terminal/);
  });

  it('lists the allowed targets when there are some', () => {
    // `d` is a declared state, so this is an illegal transition rather than an
    // unknown one — that is the branch that reports what *would* have been valid.
    const failure = createStateMachine('m', { a: ['b', 'c'], b: [], c: [], d: [] }).check('a', 'd');
    if (failure.ok) throw new Error('expected a failure');

    expect(describeTransitionFailure('m', failure)).toMatch(/Allowed: b, c/);
  });
});

/**
 * These are exhaustive on purpose. Enumerating every ordered pair means a future
 * edit to a transition table cannot quietly open a path — for example letting a
 * `cancelled` order become `paid` — because the pair it changes is already asserted.
 */
describe('order status machine', () => {
  const legal = new Set([
    'awaiting_payment>pending_verification',
    'awaiting_payment>expired',
    'awaiting_payment>cancelled',
    'pending_verification>paid',
    'pending_verification>payment_rejected',
    'pending_verification>cancelled',
    'payment_rejected>pending_verification',
    'payment_rejected>expired',
    'payment_rejected>cancelled',
    'paid>refunded',
    'paid>cancelled',
  ]);

  it.each(orderStatusMachine.states)('from %s, only declared targets are legal', (from) => {
    for (const to of orderStatusMachine.states) {
      expect(orderStatusMachine.canTransition(from, to)).toBe(legal.has(`${from}>${to}`));
    }
  });

  it('treats expired, cancelled and refunded as terminal', () => {
    expect([...orderStatusMachine.terminalStates].sort()).toEqual([
      'cancelled',
      'expired',
      'refunded',
    ]);
  });

  it('lets a rejected payment be resubmitted', () => {
    // The common cause is a mistyped UTR. Forcing a new order would release and
    // re-reserve stock the customer has already paid for.
    expect(orderStatusMachine.canTransition('payment_rejected', 'pending_verification')).toBe(true);
  });

  it('never allows payment to be reached from a terminal state', () => {
    for (const terminal of orderStatusMachine.terminalStates) {
      expect(orderStatusMachine.canTransition(terminal, 'paid')).toBe(false);
    }
  });

  it('only reaches refunded from paid', () => {
    const sources = orderStatusMachine.states.filter((state: OrderStatus) =>
      orderStatusMachine.canTransition(state, 'refunded'),
    );

    expect(sources).toEqual(['paid']);
  });
});

describe('fulfilment status machine', () => {
  it('is independent of payment status', () => {
    // A paid order can be on hold; a delivered order can be refunded. The two
    // machines share no states.
    const overlap = fulfilmentStatusMachine.states.filter((state: FulfilmentStatus) =>
      (orderStatusMachine.states as readonly string[]).includes(state),
    );

    expect(overlap).toEqual(['cancelled']);
  });

  it('does not let a shipped parcel go back to packed', () => {
    // A correction after dispatch is a return or a refund, not a rewrite of history.
    expect(fulfilmentStatusMachine.canTransition('shipped', 'packed')).toBe(false);
  });

  it('treats delivered as terminal', () => {
    expect(fulfilmentStatusMachine.isTerminal('delivered')).toBe(true);
    expect(fulfilmentStatusMachine.nextStates('delivered')).toEqual([]);
  });

  it('lets on_hold return to any pre-delivery state', () => {
    expect([...fulfilmentStatusMachine.nextStates('on_hold')].sort()).toEqual([
      'cancelled',
      'packed',
      'shipped',
      'unfulfilled',
    ]);
  });

  it('cannot reach on_hold once delivered or cancelled', () => {
    expect(fulfilmentStatusMachine.canTransition('delivered', 'on_hold')).toBe(false);
    expect(fulfilmentStatusMachine.canTransition('cancelled', 'on_hold')).toBe(false);
  });
});

describe('reservation status machine', () => {
  it('has two terminal outcomes and no way back', () => {
    expect(reservationStatusMachine.nextStates('active')).toEqual(['committed', 'released']);
    expect(reservationStatusMachine.isTerminal('committed')).toBe(true);
    expect(reservationStatusMachine.isTerminal('released')).toBe(true);
    expect(reservationStatusMachine.canTransition('released', 'active')).toBe(false);
    expect(reservationStatusMachine.canTransition('committed', 'released')).toBe(false);
  });
});

describe('review status machine', () => {
  it('allows a published review to be pulled back for re-moderation', () => {
    expect(reviewStatusMachine.canTransition('published', 'pending')).toBe(true);
  });

  it('treats rejection as terminal', () => {
    expect(reviewStatusMachine.isTerminal('rejected')).toBe(true);
  });
});

describe('product status machine', () => {
  it('forces an archived product back through draft before it can sell again', () => {
    expect(productStatusMachine.canTransition('archived', 'active')).toBe(false);
    expect(productStatusMachine.canTransition('archived', 'draft')).toBe(true);
    expect(productStatusMachine.canTransition('draft', 'active')).toBe(true);
  });

  it('has no terminal state, because archiving is reversible', () => {
    expect(productStatusMachine.terminalStates).toEqual([]);
  });
});
