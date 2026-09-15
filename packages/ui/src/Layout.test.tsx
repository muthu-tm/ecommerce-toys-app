import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageHeader, Section, Stack } from './Layout';
import { expectNoAxeViolations } from './test-axe';

describe('Stack', () => {
  it('renders a column with the tokenised gap and no colour literals', async () => {
    const { container } = render(
      <Stack gap="lg">
        <p>One</p>
        <p>Two</p>
      </Stack>,
    );

    expect(container.firstElementChild?.className).toContain('flex');
    expect(container.firstElementChild?.className).toContain('gap-8');
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/iu);
    await expectNoAxeViolations(container);
  });

  it('renders as the requested element', () => {
    const { container } = render(
      <Stack as="ul">
        <li>Item</li>
      </Stack>,
    );

    expect(container.firstElementChild?.tagName).toBe('UL');
  });
});

describe('Section', () => {
  it('renders a heading, description and action', async () => {
    const { container } = render(
      <Section title="Loved this week" description="Picked by our team" action={<a href="/c/all">See all</a>}>
        <p>Rail</p>
      </Section>,
    );

    expect(screen.getByRole('heading', { name: 'Loved this week' }).tagName).toBe('H2');
    expect(screen.getByText('Picked by our team')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('emits an h3 when nested', () => {
    render(<Section title="In the box" headingLevel={3}>x</Section>);
    expect(screen.getByRole('heading', { name: 'In the box' }).tagName).toBe('H3');
  });

  it('renders no heading when untitled', () => {
    render(
      <Section aria-label="grouping">
        <p>Body</p>
      </Section>,
    );
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});

describe('PageHeader', () => {
  it('renders exactly one h1 with eyebrow, description and actions', async () => {
    const { container } = render(
      <PageHeader
        eyebrow="New this season"
        title="Products"
        description="Manage the catalogue"
        actions={<button type="button">New product</button>}
      />,
    );

    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Products' })).toBeInTheDocument();
    expect(screen.getByText('New this season')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New product' })).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/iu);
    await expectNoAxeViolations(container);
  });
});
