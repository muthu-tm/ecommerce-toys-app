import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Stat } from './Stat';
import { expectNoAxeViolations } from './test-axe';

describe('Stat', () => {
  it('renders label, value and hint with token styling only', async () => {
    const { container } = render(<Stat label="Revenue" value="₹1,20,000" hint="Last 30 days" />);

    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('₹1,20,000')).toBeInTheDocument();
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/iu);
    await expectNoAxeViolations(container);
  });

  it('colours only the value by tone', () => {
    const { container } = render(<Stat label="Refunded" value="3" tone="danger" />);
    const value = screen.getByText('3');

    expect(value.className).toContain('text-danger');
    // The tile surface stays neutral, not a coloured fill.
    expect(container.firstElementChild?.className).toContain('bg-surface-elevated');
  });

  it('reads label before value in the DOM', () => {
    const { container } = render(<Stat label="Orders" value="42" />);
    const spans = container.querySelectorAll('span');

    expect(spans[0]?.textContent).toBe('Orders');
    expect(spans[1]?.textContent).toBe('42');
  });
});
