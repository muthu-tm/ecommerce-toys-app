import { render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Reveal, TRANSITION } from './motion';
import { setPrefersReducedMotion } from './test-setup';

/** Captures observers so a test can drive intersection by hand. */
function stubIntersectionObserver(): {
  readonly instances: { callback: IntersectionObserverCallback; disconnect: () => void }[];
} {
  const instances: { callback: IntersectionObserverCallback; disconnect: () => void }[] = [];

  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(public callback: IntersectionObserverCallback) {
        instances.push({ callback, disconnect: () => undefined });
      }
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
      root = null;
      rootMargin = '';
      thresholds = [];
    },
  );

  return { instances };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TRANSITION', () => {
  it('drives duration and easing from theme tokens', () => {
    // Not a literal duration: `--store-motion-duration` already collapses to 0ms under
    // prefers-reduced-motion, which is the safety net for any component that forgets to
    // check.
    expect(TRANSITION).toContain('duration-(--store-motion-duration)');
    expect(TRANSITION).toContain('ease-theme');
  });
});

describe('Reveal', () => {
  it('renders its children', () => {
    render(<Reveal>Featured toys</Reveal>);

    expect(screen.getByText('Featured toys')).toBeInTheDocument();
  });

  it('is visible immediately under reduced motion, and never observes', async () => {
    const { instances } = stubIntersectionObserver();
    setPrefersReducedMotion(true);

    render(<Reveal>Featured toys</Reveal>);

    await waitFor(() => {
      expect(screen.getByText('Featured toys')).toHaveAttribute('data-reveal', 'shown');
    });
    expect(instances).toHaveLength(0);
  });

  it('hides then reveals on intersection', async () => {
    const { instances } = stubIntersectionObserver();

    render(<Reveal>Featured toys</Reveal>);
    const element = screen.getByText('Featured toys');

    await waitFor(() => {
      expect(element).toHaveAttribute('data-reveal', 'hidden');
    });
    expect(element.className).toContain('opacity-0');

    const observer = instances[0];
    if (observer === undefined) throw new Error('expected an observer');
    observer.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      null as unknown as IntersectionObserver,
    );

    await waitFor(() => {
      expect(element).toHaveAttribute('data-reveal', 'shown');
    });
    expect(element.className).toContain('opacity-100');
  });

  it('does not hide content when IntersectionObserver is unavailable', async () => {
    // A reveal animation that leaves the page blank when its script cannot run is worse
    // than no animation.
    vi.stubGlobal('IntersectionObserver', undefined);

    render(<Reveal>Featured toys</Reveal>);

    await waitFor(() => {
      expect(screen.getByText('Featured toys')).toHaveAttribute('data-reveal', 'shown');
    });
  });

  it('renders visible on the server, so content is never hidden without JavaScript', () => {
    // The property that matters: a reveal animation must not leave the page blank when
    // its script has not run. `renderToStaticMarkup` runs no effects, which is exactly
    // what the server does — `render()` cannot show this because Testing Library flushes
    // effects before returning.
    const markup = renderToStaticMarkup(<Reveal>Featured toys</Reveal>);

    expect(markup).toContain('Featured toys');
    expect(markup).not.toContain('opacity-0');
    expect(markup).toContain('data-reveal="initial"');
  });

  it('renders the requested element type', () => {
    stubIntersectionObserver();
    render(
      <ul>
        <Reveal as="li">Item</Reveal>
      </ul>,
    );

    expect(screen.getByRole('listitem')).toBeInTheDocument();
  });

  it('applies a stagger delay while hidden', async () => {
    stubIntersectionObserver();
    render(<Reveal delayMs={120}>Featured toys</Reveal>);

    await waitFor(() => {
      expect(screen.getByText('Featured toys')).toHaveStyle({ transitionDelay: '120ms' });
    });
  });

  it('drops the delay once shown, so it does not affect later transitions', async () => {
    stubIntersectionObserver();
    setPrefersReducedMotion(true);

    render(<Reveal delayMs={120}>Featured toys</Reveal>);

    await waitFor(() => {
      expect(screen.getByText('Featured toys')).toHaveAttribute('data-reveal', 'shown');
    });
    expect(screen.getByText('Featured toys').style.transitionDelay).toBe('');
  });
});
