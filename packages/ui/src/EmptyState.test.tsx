import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmptyState } from './EmptyState';
import { expectNoAxeViolations } from './test-axe';

describe('EmptyState', () => {
  it('renders configured copy, an icon and an action', async () => {
    const { container } = render(
      <EmptyState
        icon={<svg aria-hidden="true" viewBox="0 0 1 1" />}
        title="Your bag is empty"
        body="Start with what suits their age."
        action={<a href="/c/all">Browse toys</a>}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Your bag is empty' })).toBeInTheDocument();
    expect(screen.getByText('Start with what suits their age.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse toys' })).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/iu);
    await expectNoAxeViolations(container);
  });

  it('renders without an icon or action', async () => {
    const { container } = render(<EmptyState title="Nothing new" body="Updates appear here." />);
    expect(screen.getByRole('heading', { name: 'Nothing new' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
