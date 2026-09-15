import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { InitialTile } from './InitialTile';
import { expectNoAxeViolations } from './test-axe';

describe('InitialTile', () => {
  it('shows the first character of the name, hidden from assistive tech', async () => {
    const { container } = render(<InitialTile name="Wooden blocks" />);

    // The visible glyph is decorative — the product name lives in surrounding markup.
    const glyph = container.querySelector('[aria-hidden="true"]');
    expect(glyph?.textContent).toBe('W');
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/iu);
    await expectNoAxeViolations(container);
  });

  it('scales the glyph by size', () => {
    const { container } = render(<InitialTile name="Puzzle" size="xl" />);
    expect(container.firstElementChild?.className).toContain('text-6xl');
  });

  it('renders an overlay child above the initial', () => {
    render(
      <InitialTile name="Market stall">
        <span>processing</span>
      </InitialTile>,
    );
    expect(screen.getByText('processing')).toBeInTheDocument();
  });
});
