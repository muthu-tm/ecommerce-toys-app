/**
 * A tiny state-machine helper over a declared transition table.
 *
 * The tables are **data**, not branching logic, so the legal transitions of an
 * order can be read in one screen and tested exhaustively — every ordered pair of
 * states, not just the paths someone remembered to write a test for.
 *
 * What lives here and what does not:
 *
 * - Here: which transitions the table permits. That is a property of the table.
 * - Not here: whether *this caller* may make the transition. "Only an owner may
 *   refund" is authorisation, and it belongs with the handler.
 *
 * This module also does not throw. It returns a discriminated result, and the
 * caller turns a rejection into an `AppError`. Throwing would mean importing the
 * error taxonomy from `@romp/observability`, which depends on this package — the
 * dependency has to point one way.
 */

/** Which states each state may move to. A state with no outgoing edges is terminal. */
export type TransitionTable<TState extends string> = Readonly<Record<TState, readonly TState[]>>;

export type TransitionCheck<TState extends string> =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'unknown_from' | 'unknown_to' | 'illegal_transition';
      readonly from: string;
      readonly to: string;
      readonly allowed: readonly TState[];
    };

export interface StateMachine<TState extends string> {
  /** Machine name, used in error messages so a rejection says *which* machine refused. */
  readonly name: string;
  /** Every declared state. */
  readonly states: readonly TState[];
  /** States with no outgoing transitions. */
  readonly terminalStates: readonly TState[];
  readonly table: TransitionTable<TState>;
  isState: (value: string) => value is TState;
  isTerminal: (state: TState) => boolean;
  nextStates: (state: TState) => readonly TState[];
  /** Full check with a reason, for turning into a typed error. */
  check: (from: string, to: string) => TransitionCheck<TState>;
  /** Convenience predicate for call sites that only need yes or no. */
  canTransition: (from: string, to: string) => boolean;
}

/**
 * The generic is inferred from the table's **keys**, not its values.
 *
 * That distinction matters: inferring from the values drops every terminal state
 * from the union, because a terminal state appears only as a key with an empty
 * array. The self-referential constraint keeps targets checked against the declared
 * key set at compile time as well.
 */
export function createStateMachine<
  TTable extends { readonly [K in keyof TTable]: readonly Extract<keyof TTable, string>[] },
>(name: string, table: TTable): StateMachine<Extract<keyof TTable, string>> {
  type TState = Extract<keyof TTable, string>;

  const states = Object.freeze(Object.keys(table) as TState[]);
  const stateSet = new Set<string>(states);

  // A transition pointing at a state the table does not declare is a typo. The
  // constraint above catches it at compile time for literal tables; this catches it
  // for anything built dynamically, where it would otherwise surface as a runtime
  // rejection much later, in whichever code path attempted it first.
  for (const [from, targets] of Object.entries(table) as [TState, readonly TState[]][]) {
    for (const target of targets) {
      if (!stateSet.has(target)) {
        throw new Error(
          `${name} state machine: "${from}" declares a transition to "${target}", which is not a declared state.`,
        );
      }
    }
    if (targets.includes(from)) {
      throw new Error(
        `${name} state machine: "${from}" declares a transition to itself. Re-entering a state is a no-op, not a transition; if a repeat action must be allowed, make the handler idempotent instead.`,
      );
    }
  }

  const terminalStates = Object.freeze(states.filter((state) => table[state].length === 0));

  const isState = (value: string): value is TState => stateSet.has(value);

  const check = (from: string, to: string): TransitionCheck<TState> => {
    if (!isState(from)) {
      return { ok: false, reason: 'unknown_from', from, to, allowed: [] };
    }
    if (!isState(to)) {
      return { ok: false, reason: 'unknown_to', from, to, allowed: table[from] };
    }
    if (!table[from].includes(to)) {
      return { ok: false, reason: 'illegal_transition', from, to, allowed: table[from] };
    }
    return { ok: true };
  };

  return Object.freeze({
    name,
    states,
    terminalStates,
    table,
    isState,
    isTerminal: (state: TState) => table[state].length === 0,
    nextStates: (state: TState) => table[state],
    check,
    canTransition: (from: string, to: string) => check(from, to).ok,
  });
}

/** Renders a rejection as a message safe to show a developer (not a customer). */
export function describeTransitionFailure<TState extends string>(
  machineName: string,
  failure: Extract<TransitionCheck<TState>, { ok: false }>,
): string {
  switch (failure.reason) {
    case 'unknown_from':
      return `${machineName}: "${failure.from}" is not a known state.`;
    case 'unknown_to':
      return `${machineName}: "${failure.to}" is not a known state.`;
    case 'illegal_transition':
      return failure.allowed.length === 0
        ? `${machineName}: "${failure.from}" is terminal, so it cannot move to "${failure.to}".`
        : `${machineName}: cannot move from "${failure.from}" to "${failure.to}". Allowed: ${failure.allowed.join(', ')}.`;
  }
}
