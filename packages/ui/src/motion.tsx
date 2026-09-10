'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { cn } from './cn';

/**
 * Motion primitives.
 *
 * A toy store should feel playful, and this is a performance-budgeted storefront, so
 * motion here is CSS transitions driven by theme tokens rather than an animation
 * library. No runtime, nothing on the critical path, and `transition-duration` already
 * collapses to `0ms` under `prefers-reduced-motion` because the token does — see the
 * emitted stylesheet.
 *
 * Two layers of reduced-motion handling, deliberately:
 *
 *  1. **Tokens.** `--store-motion-duration` becomes `0ms`, so a component that forgets
 *     to check anything still animates instantly. That is the safety net.
 *  2. **`useReducedMotion`.** For motion that duration alone cannot fix — an autoplaying
 *     carousel, a parallax offset — where the right behaviour is not to do it at all.
 */

/**
 * Whether the user has asked for reduced motion.
 *
 * Starts `true` and corrects after mount. That default matters: the server cannot know
 * the preference, so assuming "no motion" means a user who asked for reduced motion
 * never sees a frame of animation, whereas the opposite default would flash one before
 * correcting itself.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);

    const onChange = (event: MediaQueryListEvent): void => {
      setReduced(event.matches);
    };
    query.addEventListener('change', onChange);
    return () => {
      query.removeEventListener('change', onChange);
    };
  }, []);

  return reduced;
}

/** Transition classes wired to the theme's duration and easing tokens. */
export const TRANSITION = 'transition-all duration-(--store-motion-duration) ease-theme';

export interface RevealProps {
  readonly children: ReactNode;
  /** Delay in milliseconds, for staggering a row of cards. */
  readonly delayMs?: number;
  readonly className?: string;
  /** Element to render. Defaults to a `div`. */
  readonly as?: 'div' | 'section' | 'li' | 'article';
}

/**
 * Fades and lifts its children into view once, when scrolled to.
 *
 * Uses `IntersectionObserver` rather than a scroll listener, so there is no work on the
 * main thread between intersections.
 *
 * Two properties worth stating, because both are easy to get wrong and both are
 * user-visible:
 *
 *  - **It never hides content that has not animated yet in a way that outlives JS.**
 *    The initial hidden state is applied only after mount, so with JavaScript disabled or
 *    still loading, the content is simply visible. A reveal animation that leaves a page
 *    blank when its script fails is worse than no animation.
 *  - **Under reduced motion it renders visible immediately** and never observes.
 */
export function Reveal({
  children,
  delayMs = 0,
  className,
  as: Element = 'div',
}: RevealProps): ReactNode {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<'initial' | 'hidden' | 'shown'>('initial');

  useEffect(() => {
    if (reduced) {
      setState('shown');
      return;
    }

    const element = ref.current;
    if (element === null) return;

    // Only now is it safe to hide: JavaScript is running and an observer is about to
    // watch this element.
    setState('hidden');

    if (typeof IntersectionObserver === 'undefined') {
      setState('shown');
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setState('shown');
            observer.disconnect();
          }
        }
      },
      // A little early, so the animation is finishing as the element arrives rather
      // than starting once it is already in view.
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [reduced]);

  return (
    <Element
      ref={ref as never}
      data-reveal={state}
      className={cn(
        TRANSITION,
        state === 'hidden' && 'translate-y-3 opacity-0 motion-reduce:translate-y-0',
        state !== 'hidden' && 'translate-y-0 opacity-100',
        className,
      )}
      style={
        delayMs > 0 && state !== 'shown' ? { transitionDelay: `${String(delayMs)}ms` } : undefined
      }
    >
      {children}
    </Element>
  );
}
