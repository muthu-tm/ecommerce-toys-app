import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * jsdom does not implement `matchMedia`, and `useReducedMotion` calls it on mount.
 *
 * The stub reports **no** preference, i.e. motion is allowed. That is the harder case to
 * get right — a component under reduced motion mostly just does less — so it is the
 * sensible default for tests, and the reduced-motion path is asserted explicitly by
 * overriding this where it matters.
 */
function stubMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

stubMatchMedia(false);

/** Re-stub for a test that needs the reduced-motion branch. */
export function setPrefersReducedMotion(reduced: boolean): void {
  stubMatchMedia(reduced);
}

afterEach(() => {
  cleanup();
  // Reset, so a test that opted into reduced motion cannot leak into the next one.
  stubMatchMedia(false);
});
