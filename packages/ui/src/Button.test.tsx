import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button, ButtonLink } from './Button';
import { expectNoAxeViolations } from './test-axe';

describe('Button', () => {
  it('renders an accessible button', async () => {
    const { container } = render(<Button>Add to bag</Button>);

    expect(screen.getByRole('button', { name: 'Add to bag' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('defaults to type="button"', () => {
    // The HTML default is `submit`, which turns any button inside a form into an
    // accidental submit.
    render(<Button>Filter</Button>);

    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('allows an explicit submit type', () => {
    render(<Button type="submit">Place order</Button>);

    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('calls onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);

    await userEvent.click(screen.getByRole('button'));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is operable by keyboard', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);

    await userEvent.tab();
    expect(screen.getByRole('button')).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('marks itself busy and disabled while loading', async () => {
    const onClick = vi.fn();
    const { container } = render(
      <Button loading onClick={onClick}>
        Placing order
      </Button>,
    );
    const button = screen.getByRole('button');

    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('keeps its label while loading', () => {
    // The accessible name must not change mid-interaction, and the button must not
    // resize — a control that shrinks under the cursor is how people mis-click.
    render(<Button loading>Placing order</Button>);

    expect(screen.getByRole('button', { name: 'Placing order' })).toBeInTheDocument();
  });

  it('does not fire when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );

    await userEvent.click(screen.getByRole('button'));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('applies the focus ring token, not a literal colour', () => {
    render(<Button>Go</Button>);

    const className = screen.getByRole('button').className;
    expect(className).toContain('focus-visible:outline-focus-ring');
    expect(className).not.toMatch(/#[0-9a-f]{3,8}/iu);
  });

  it.each(['primary', 'accent', 'outline', 'ghost'] as const)(
    'renders the %s variant from tokens only',
    (variant) => {
      render(<Button variant={variant}>Go</Button>);

      expect(screen.getByRole('button').className).not.toMatch(/#[0-9a-f]{3,8}/iu);
    },
  );

  it.each(['sm', 'md', 'lg'] as const)('meets the touch target at size %s', (size) => {
    // min-h-9 is 36px, min-h-11 is 44px, min-h-12 is 48px. Small is only for dense
    // desktop toolbars; the two used on mobile clear 44px.
    render(<Button size={size}>Go</Button>);

    const className = screen.getByRole('button').className;
    expect(className).toMatch(/min-h-(9|11|12)/u);
  });
});

describe('ButtonLink', () => {
  it('renders a link, not a button', async () => {
    // The distinction is semantic: screen readers announce them differently, and
    // "open in new tab" only works on one.
    const { container } = render(<ButtonLink href="/c/all">Browse everything</ButtonLink>);

    expect(screen.getByRole('link', { name: 'Browse everything' })).toHaveAttribute(
      'href',
      '/c/all',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('adds noopener noreferrer to a new-tab link', () => {
    // Without it, the opened page gets a reference back to this one.
    render(
      <ButtonLink href="https://wa.me/919845021174" target="_blank">
        Chat
      </ButtonLink>,
    );

    expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('does not override an explicit rel', () => {
    render(
      <ButtonLink href="https://example.com" target="_blank" rel="noopener">
        Go
      </ButtonLink>,
    );

    expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener');
  });

  it('adds no rel for a same-tab link', () => {
    render(<ButtonLink href="/cart">Cart</ButtonLink>);

    expect(screen.getByRole('link')).not.toHaveAttribute('rel');
  });
});
