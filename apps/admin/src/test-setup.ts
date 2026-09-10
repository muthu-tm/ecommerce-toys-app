import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Stubs for Next's framework modules, which are not loadable in jsdom the way the app loads
 * them. `next/image` becomes a plain `<img>`; `next/link` becomes an `<a>`; `next/cache`
 * becomes a pass-through. Same reasoning as the storefront's setup.
 */
vi.mock('next/image', async () => {
  const { createElement } = await import('react');
  return {
    default: (props: { src: string; alt: string; sizes?: string; className?: string }) =>
      createElement('img', {
        src: props.src,
        alt: props.alt,
        sizes: props.sizes,
        className: props.className,
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
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

/** jsdom implements neither `matchMedia` nor `IntersectionObserver`, and `@romp/ui` uses both. */
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
