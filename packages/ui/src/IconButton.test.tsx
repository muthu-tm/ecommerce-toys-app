import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { IconButton } from './IconButton';
import { expectNoAxeViolations } from './test-axe';

const CartIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" className="size-5">
    <circle cx="8" cy="17" r="1.5" fill="currentColor" />
  </svg>
);

describe('IconButton', () => {
  it('has an accessible name despite having no visible text', async () => {
    // An icon-only button with no label is announced as just "button" — the most common
    // accessibility defect in a commerce UI, since it is every cart, close and menu
    // control.
    const { container } = render(
      <IconButton label="Cart">
        <CartIcon />
      </IconButton>,
    );

    expect(screen.getByRole('button', { name: 'Cart' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('puts the badge count in the accessible name', async () => {
    // A visual "3" tells a sighted user how many items there are and tells a
    // screen-reader user nothing.
    const { container } = render(
      <IconButton label="Cart" badge={3}>
        <CartIcon />
      </IconButton>,
    );

    expect(screen.getByRole('button', { name: 'Cart (3)' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('hides the visual badge from assistive technology', () => {
    // It is already in the accessible name; announcing it twice is noise.
    render(
      <IconButton label="Notifications" badge={5}>
        <CartIcon />
      </IconButton>,
    );

    const badge = screen.getByRole('button').querySelector('[aria-hidden="true"]:not(svg)');
    expect(badge).toHaveTextContent('5');
  });

  it('omits the badge at zero', () => {
    render(
      <IconButton label="Cart" badge={0}>
        <CartIcon />
      </IconButton>,
    );

    expect(screen.getByRole('button', { name: 'Cart' })).toBeInTheDocument();
  });

  it('caps a runaway count so it cannot break the layout', () => {
    render(
      <IconButton label="Notifications" badge={1234}>
        <CartIcon />
      </IconButton>,
    );

    expect(screen.getByRole('button', { name: 'Notifications (99+)' })).toBeInTheDocument();
  });

  it('meets the 44px touch target', () => {
    render(
      <IconButton label="Cart">
        <CartIcon />
      </IconButton>,
    );

    // size-11 is 44px.
    expect(screen.getByRole('button').className).toContain('size-11');
  });

  it('is clickable and keyboard-operable', async () => {
    const onClick = vi.fn();
    render(
      <IconButton label="Cart" onClick={onClick}>
        <CartIcon />
      </IconButton>,
    );

    const button = screen.getByRole('button');

    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();

    // Clicking already left focus on the button, so Enter and Space act on it directly.
    expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');

    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it('defaults to type="button"', () => {
    render(
      <IconButton label="Cart">
        <CartIcon />
      </IconButton>,
    );

    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });
});
