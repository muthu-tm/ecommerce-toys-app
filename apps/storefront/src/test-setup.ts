import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Next's framework modules are not loadable in jsdom the way the app loads them, so they
 * are stubbed here to their observable behaviour.
 *
 * `next/image` becomes a plain `<img>` that forwards `src`, `alt`, `sizes` and a
 * data-priority marker — everything a test asserts about image wiring — without Next's
 * build-time optimisation, which needs a running server. `next/link` becomes an `<a>`.
 * `next/navigation`'s router and search-params hooks return controllable fakes, so a
 * client control's URL writes are observable. `next/cache`'s `unstable_cache` becomes a
 * pass-through, because the caching is a production concern and a test asserts the data,
 * not the cache.
 */
vi.mock('next/image', async () => {
  const { createElement } = await import('react');
  return {
    default: (props: {
      src: string;
      alt: string;
      sizes?: string;
      priority?: boolean;
      className?: string;
    }) =>
      createElement('img', {
        src: props.src,
        alt: props.alt,
        sizes: props.sizes,
        className: props.className,
        'data-priority': props.priority === true ? 'true' : undefined,
      }),
  };
});

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({
      href,
      children,
      ...rest
    }: {
      href: string;
      children: React.ReactNode;
      [key: string]: unknown;
    }) => createElement('a', { href, ...rest }, children),
  };
});

vi.mock('next/cache', () => ({
  // The cache is transparent in a test: run the function, return the value.
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

/**
 * jsdom implements neither `matchMedia` nor `IntersectionObserver`, and `@romp/ui` uses
 * both — `useReducedMotion` and `Reveal` respectively.
 *
 * `matchMedia` reports **no** preference, i.e. motion is allowed. That is the harder case:
 * under reduced motion a component mostly just does less, so allowing motion exercises
 * more behaviour. `@romp/ui` asserts the reduced-motion branch directly in its own tests.
 *
 * `next/font/google` is stubbed by an alias in `vitest.config.ts` rather than here,
 * because `vi.mock` is hoisted per test file and does not apply from a setup file.
 */
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

class NoopIntersectionObserver {
  observe = (): void => undefined;
  disconnect = (): void => undefined;
  unobserve = (): void => undefined;
  takeRecords = (): IntersectionObserverEntry[] => [];
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
}

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: NoopIntersectionObserver,
});

afterEach(() => {
  cleanup();
});
