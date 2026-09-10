import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Field } from './Field';
import { expectNoAxeViolations } from './test-axe';

describe('Field', () => {
  it('associates the label with the control', async () => {
    // getByLabelText only resolves when htmlFor/id are wired correctly, so this is the
    // association test, not just a rendering test.
    const { container } = render(<Field label="Mobile number" name="phone" />);

    expect(screen.getByLabelText('Mobile number')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('generates unique ids for repeated fields', () => {
    // Duplicate ids silently break label association for every field after the first.
    const { container } = render(
      <>
        <Field label="First" />
        <Field label="Second" />
      </>,
    );

    const ids = [...container.querySelectorAll('input')].map((input) => input.id);
    expect(new Set(ids).size).toBe(2);
    expect(screen.getByLabelText('First')).toBeInTheDocument();
    expect(screen.getByLabelText('Second')).toBeInTheDocument();
  });

  it('describes the control with its hint', async () => {
    // aria-describedby, so the hint is read as part of the field rather than as loose
    // text somewhere nearby.
    const { container } = render(
      <Field label="Mobile number" hint="We use this for delivery updates on WhatsApp." />,
    );

    expect(screen.getByLabelText('Mobile number')).toHaveAccessibleDescription(
      'We use this for delivery updates on WhatsApp.',
    );
    await expectNoAxeViolations(container);
  });

  it('marks an invalid field and describes the error', async () => {
    const { container } = render(
      <Field label="Mobile number" error="Enter a 10-digit mobile number." />,
    );
    const input = screen.getByLabelText('Mobile number');

    // aria-invalid conveys the state by more than colour.
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a 10-digit mobile number.');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a 10-digit mobile number.');
    await expectNoAxeViolations(container);
  });

  it('describes the control with both hint and error', () => {
    render(<Field label="Mobile" hint="With country code." error="That is not valid." />);

    expect(screen.getByLabelText('Mobile')).toHaveAccessibleDescription(
      'With country code. That is not valid.',
    );
  });

  it('is not marked invalid without an error', () => {
    render(<Field label="Mobile" />);

    expect(screen.getByLabelText('Mobile')).not.toHaveAttribute('aria-invalid');
  });

  it('keeps the live region mounted so a late error is announced', () => {
    // A live region inserted at the same moment as its content is often not announced,
    // which is exactly the case for a validation error arriving after submit.
    const { rerender } = render(<Field label="Mobile" />);

    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(<Field label="Mobile" error="Required" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });

  it('announces a required field beyond the asterisk', async () => {
    // An asterisk alone is a visual convention a screen reader does not convey.
    const { container } = render(<Field label="Mobile number" required />);

    expect(screen.getByLabelText(/required/iu)).toBeInTheDocument();
    expect(screen.getByLabelText(/Mobile number/u)).toBeRequired();
    await expectNoAxeViolations(container);
  });

  it('keeps a hidden label available to assistive technology', async () => {
    const { container } = render(<Field label="Search toys" labelHidden />);

    // Still resolvable by its label, just not visible.
    expect(screen.getByLabelText('Search toys')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('accepts typing and forwards input props', async () => {
    render(<Field label="Mobile" type="tel" autoComplete="tel" />);
    const input = screen.getByLabelText('Mobile');

    await userEvent.type(input, '9845021174');

    expect(input).toHaveValue('9845021174');
    expect(input).toHaveAttribute('type', 'tel');
    expect(input).toHaveAttribute('autocomplete', 'tel');
  });

  it('is reachable by keyboard', async () => {
    render(<Field label="Mobile" />);

    await userEvent.tab();

    expect(screen.getByLabelText('Mobile')).toHaveFocus();
  });

  it('uses tokens rather than literal colours', () => {
    const { container } = render(<Field label="Mobile" error="Bad" />);

    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/iu);
  });
});
