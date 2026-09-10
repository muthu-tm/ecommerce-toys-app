import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { cn } from './cn';
import { Badge, Card, Skeleton, SkipLink } from './Surface';
import { expectNoAxeViolations } from './test-axe';

describe('cn', () => {
  it('joins class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('drops falsy values', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b');
  });

  it('flattens arrays', () => {
    expect(cn(['a', ['b', 'c']], 'd')).toBe('a b c d');
  });

  it('deduplicates repeated classes', () => {
    // Harmless in CSS, but repeated classes make a failing test's markup hard to read.
    expect(cn('a b', 'b c')).toBe('a b c');
  });

  it('splits multi-class strings', () => {
    expect(cn('  a   b  ')).toBe('a b');
  });

  it('returns an empty string for no input', () => {
    expect(cn()).toBe('');
  });
});

describe('Card', () => {
  it('renders its children with token styling only', async () => {
    const { container } = render(<Card>Product</Card>);

    expect(screen.getByText('Product')).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/iu);
    await expectNoAxeViolations(container);
  });

  it('adds hover lift only when interactive', () => {
    const { container: plain } = render(<Card>Plain</Card>);
    const { container: interactive } = render(<Card interactive>Interactive</Card>);

    expect(plain.firstElementChild?.className).not.toContain('hover:-translate-y-0.5');
    expect(interactive.firstElementChild?.className).toContain('hover:-translate-y-0.5');
  });

  it('cancels the lift under reduced motion', () => {
    const { container } = render(<Card interactive>Interactive</Card>);

    expect(container.firstElementChild?.className).toContain('motion-reduce:hover:translate-y-0');
  });
});

describe('Badge', () => {
  it('renders each tone from tokens', async () => {
    for (const tone of ['neutral', 'primary', 'accent', 'success', 'warning', 'danger'] as const) {
      const { container } = render(<Badge tone={tone}>Bestseller</Badge>);
      expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/iu);
    }

    const { container } = render(<Badge>Bestseller</Badge>);
    await expectNoAxeViolations(container);
  });

  it('renders status tones as text on a neutral surface', () => {
    // The contrast gate holds status colours to AA as *text*. A coloured fill would need
    // its own on-colour token per tone to make the same guarantee.
    const { container } = render(<Badge tone="danger">Rejected</Badge>);

    expect(container.firstElementChild?.className).toContain('text-danger');
    expect(container.firstElementChild?.className).toContain('bg-surface-alt');
  });
});

describe('Skeleton', () => {
  it('is hidden from assistive technology', () => {
    // A screen reader should hear the region's busy state, not a description of grey
    // rectangles.
    const { container } = render(<Skeleton className="h-4 w-24" />);

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('stops pulsing under reduced motion', () => {
    const { container } = render(<Skeleton />);

    expect(container.firstElementChild?.className).toContain('motion-reduce:animate-none');
  });
});

describe('SkipLink', () => {
  it('links to the main landmark', async () => {
    const { container } = render(
      <>
        <SkipLink />
        <main id="main-content">Content</main>
      </>,
    );

    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#main-content',
    );
    await expectNoAxeViolations(container);
  });

  it('is the first thing a keyboard user reaches', async () => {
    // Without it, a keyboard user tabs through the entire header on every page.
    render(
      <>
        <SkipLink />
        <a href="/c/all">Browse</a>
      </>,
    );

    await userEvent.tab();

    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus();
  });

  it('is visually hidden until focused', () => {
    render(<SkipLink />);
    const className = screen.getByRole('link').className;

    expect(className).toContain('sr-only');
    expect(className).toContain('focus:not-sr-only');
  });

  it('accepts a configured target and label', () => {
    render(<SkipLink targetId="catalogue">Seedha content par jaayein</SkipLink>);

    expect(screen.getByRole('link', { name: 'Seedha content par jaayein' })).toHaveAttribute(
      'href',
      '#catalogue',
    );
  });
});
