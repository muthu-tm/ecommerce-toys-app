import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { Dialog } from './Dialog';
import { expectNoAxeViolations } from './test-axe';

/** A realistic host: a trigger that opens the dialog, so focus restoration is testable. */
function Host({ onClosed }: { readonly onClosed?: () => void } = {}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        Open
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          onClosed?.();
        }}
        title="Confirm removal"
        footer={
          <>
            <Button variant="ghost">Cancel</Button>
            <Button variant="accent">Remove</Button>
          </>
        }
      >
        This removes the item from your bag.
      </Dialog>
      <Button>After</Button>
    </>
  );
}

describe('Dialog', () => {
  it('renders nothing while closed', () => {
    render(
      <Dialog open={false} onClose={vi.fn()} title="Hidden">
        Body
      </Dialog>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is an accessible modal labelled by its visible title', async () => {
    const { container } = render(
      <Dialog open onClose={vi.fn()} title="Confirm removal">
        Body
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // The name must come from the visible heading, so it is announced on open.
    expect(dialog).toHaveAccessibleName('Confirm removal');
    expect(screen.getByRole('heading', { name: 'Confirm removal' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('moves focus to the first tabbable element, not the container', async () => {
    // Focusing the container means the user's first Tab appears to do nothing.
    render(<Host />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('restores focus to the trigger on close', async () => {
    // Otherwise the user is dumped at the top of the document with no idea where they
    // were.
    render(<Host />);
    const trigger = screen.getByRole('button', { name: 'Open' });

    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(trigger).toHaveFocus();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Confirm">
        Body
      </Dialog>,
    );

    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('traps Tab inside the dialog', async () => {
    // A modal must trap Tab, or a keyboard user walks into the inert page behind it.
    render(<Host />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));

    const close = screen.getByRole('button', { name: 'Close' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const remove = screen.getByRole('button', { name: 'Remove' });

    expect(close).toHaveFocus();
    await userEvent.tab();
    expect(cancel).toHaveFocus();
    await userEvent.tab();
    expect(remove).toHaveFocus();

    // Wraps rather than escaping to the "After" button behind the dialog.
    await userEvent.tab();
    expect(close).toHaveFocus();
  });

  it('traps Shift+Tab too', async () => {
    // Without the Shift branch, Shift+Tab from the first element walks straight out.
    render(<Host />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.tab({ shift: true });

    expect(screen.getByRole('button', { name: 'Remove' })).toHaveFocus();
  });

  it('never traps the user with no way out', async () => {
    // The other half of "keyboard traps handled": Escape always works, even with no
    // footer actions to tab between.
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Minimal">
        Body
      </Dialog>,
    );

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('locks background scroll while open and restores it after', async () => {
    document.body.style.overflow = 'auto';
    render(<Host />);

    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(document.body.style.overflow).toBe('hidden');

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    // Restores the previous value rather than clearing it.
    expect(document.body.style.overflow).toBe('auto');
  });

  it('closes on a backdrop click', async () => {
    const onClose = vi.fn();
    const { container } = render(
      <Dialog open onClose={onClose} title="Confirm">
        Body
      </Dialog>,
    );
    const backdrop = container.querySelector('[aria-hidden="true"]');
    if (backdrop === null) throw new Error('expected a backdrop');

    await userEvent.click(backdrop);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not close when a drag starts inside and ends on the backdrop', async () => {
    // Selecting text in the dialog and releasing outside should not discard it.
    const onClose = vi.fn();
    const { container } = render(
      <Dialog open onClose={onClose} title="Confirm">
        Body
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    const backdrop = container.querySelector('[aria-hidden="true"]');
    if (backdrop === null) throw new Error('expected a backdrop');

    await userEvent.pointer([
      { target: dialog, keys: '[MouseLeft>]' },
      { target: backdrop },
      { target: backdrop, keys: '[/MouseLeft]' },
    ]);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('accepts a configured close label', () => {
    // The label is copy, so it comes from store config in real use.
    render(
      <Dialog open onClose={vi.fn()} title="Confirm" closeLabel="Band karo">
        Body
      </Dialog>,
    );

    expect(screen.getByRole('button', { name: 'Band karo' })).toBeInTheDocument();
  });
});
