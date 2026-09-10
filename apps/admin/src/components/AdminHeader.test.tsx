import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { brand } from '@/lib/store';

import { AdminHeader } from './AdminHeader';

describe('AdminHeader', () => {
  it('shows the configured store name and a products link', () => {
    render(<AdminHeader />);
    expect(screen.getByText(brand.name)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Products' })).toHaveAttribute('href', '/');
  });
});
