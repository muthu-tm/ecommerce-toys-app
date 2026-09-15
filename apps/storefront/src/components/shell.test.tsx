import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { brand, content, contact, features } from '@/lib/store';

import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import { Wordmark } from './Wordmark';

/**
 * The shell, asserted against the *generated* store config rather than a fixture.
 *
 * That is deliberate: these tests read the same artefact the app renders from, so they
 * verify the wiring end to end. Where a value is asserted, it comes from config — the
 * tests would fail for a store whose config disagreed, which is the point.
 */

async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, {
    // No layout in jsdom, so contrast cannot be evaluated here. It is gated far more
    // strictly against the palette itself in @romp/store-config.
    rules: { 'color-contrast': { enabled: false } },
  });

  if (results.violations.length > 0) {
    expect.fail(
      results.violations.map((violation) => `${violation.id}: ${violation.help}`).join('\n'),
    );
  }
}

describe('Wordmark', () => {
  it('uses the configured store name as its accessible name', () => {
    render(<Wordmark />);

    // Not "logo": the role is already announced, so "ROMP logo, link" is redundant.
    expect(screen.getByRole('link', { name: `${brand.name} — home` })).toHaveAttribute('href', '/');
  });

  it('renders both theme variants of the artwork from public/brand', () => {
    render(<Wordmark />);

    // Both the dark-surface and light-surface wordmarks are rendered; CSS shows the one
    // matching the active theme (`.theme-dark-only` / `.theme-light-only`), so the ink always
    // matches the surface. Both carry the store name as alt.
    const sources = screen.getAllByAltText(brand.name).map((image) => image.getAttribute('src'));
    expect(sources.some((src) => src?.includes('logo-dark.svg'))).toBe(true);
    expect(sources.some((src) => src?.includes('logo-light.svg'))).toBe(true);
  });

  it('uses the square mark when compact', () => {
    render(<Wordmark compact />);

    expect(screen.getByAltText(brand.name).getAttribute('src')).toContain('mark.svg');
  });
});

describe('SiteHeader', () => {
  it('is accessible', async () => {
    const { container } = render(<SiteHeader />);

    await expectNoAxeViolations(container);
  });

  it('builds its nav from Shop by age and All toys, not from categories', () => {
    render(<SiteHeader />);

    const nav = screen.getByRole('navigation', { name: 'Shop' });
    const links = [...nav.querySelectorAll('a')].map((link) => link.textContent);

    expect(links).toEqual(['Shop by age', 'All toys']);
    expect(nav.querySelector('a[href="/#shop-by-age"]')).not.toBeNull();
    expect(nav.querySelector('a[href="/c/all"]')).not.toBeNull();
  });

  it('does not put catalogue categories in the header', () => {
    render(<SiteHeader />);
    const nav = screen.getByRole('navigation', { name: 'Shop' });

    for (const category of content.categories) {
      expect(nav.querySelector(`a[href="/c/${category.slug}"]`)).toBeNull();
    }
  });

  it('gives the search input a real label, not just a placeholder', () => {
    // A placeholder is not an accessible name, and it vanishes as soon as the user types.
    render(<SiteHeader />);

    expect(screen.getByRole('searchbox', { name: 'Search toys' })).toBeInTheDocument();
  });

  it('names every icon-only control', () => {
    render(<SiteHeader />);

    for (const name of ['Menu']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    // The notification bell renders as a link to the account area while signed out (there
    // is no client auth yet); it becomes a menu button once a uid is supplied.
    for (const name of ['Your account', 'Your bag', 'Notifications']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
  });

  it('respects the wishlist feature flag', () => {
    render(<SiteHeader />);

    const wishlist = screen.queryByRole('link', { name: 'Saved toys' });
    if (features.wishlist) {
      expect(wishlist).toBeInTheDocument();
    } else {
      expect(wishlist).not.toBeInTheDocument();
    }
  });
});

describe('MobileNav', () => {
  it('opens a labelled dialog listing shop links and age bands', async () => {
    render(<SiteHeader />);

    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Browse');
    expect(screen.getByRole('navigation', { name: 'Browse' })).toBeInTheDocument();

    expect(within(dialog).getByRole('link', { name: 'Shop by age' })).toHaveAttribute(
      'href',
      '/#shop-by-age',
    );
    expect(within(dialog).getByRole('link', { name: 'All toys' })).toHaveAttribute(
      'href',
      '/c/all',
    );

    for (const band of content.ageBands) {
      expect(screen.getByRole('link', { name: band.label })).toHaveAttribute(
        'href',
        `/age/${band.value}`,
      );
    }
  });

  it('reports its expanded state', async () => {
    render(<SiteHeader />);
    const trigger = screen.getByRole('button', { name: 'Menu' });

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    expect(screen.getAllByRole('button', { name: 'Menu' })[0]).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    render(<SiteHeader />);
    const trigger = screen.getByRole('button', { name: 'Menu' });

    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe('SiteFooter', () => {
  it('is accessible', async () => {
    const { container } = render(<SiteFooter />);

    await expectNoAxeViolations(container);
  });

  it('renders the configured columns and links', () => {
    render(<SiteFooter />);

    for (const column of content.footer.columns) {
      expect(screen.getByRole('heading', { name: column.title })).toBeInTheDocument();
      for (const link of column.links) {
        expect(screen.getByRole('link', { name: link.label })).toHaveAttribute('href', link.href);
      }
    }
  });

  it('renders the configured legal line', () => {
    render(<SiteFooter />);

    expect(screen.getByText(content.footer.legalLine)).toBeInTheDocument();
  });

  it('links support to WhatsApp using the configured number', () => {
    // Support is WhatsApp because the platform sends no email (ADR-0007).
    render(<SiteFooter />);

    // Matched on the full accessible name, including the new-tab announcement, so this
    // cannot silently start matching a configured footer link with similar wording.
    const link = screen.getByRole('link', { name: 'Chat on WhatsApp (opens in a new tab)' });
    const expectedNumber = contact.whatsappNumber.replace('+', '');

    expect(link).toHaveAttribute('href', expect.stringContaining(`wa.me/${expectedNumber}`));
    expect(link).toHaveAttribute('target', '_blank');
    // Without noreferrer the opened page gets a handle back to this one.
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('announces that the support link opens a new tab', () => {
    render(<SiteFooter />);

    expect(screen.getByRole('link', { name: /opens in a new tab/u })).toBeInTheDocument();
  });

  it('shows the configured support hours', () => {
    render(<SiteFooter />);

    expect(screen.getByText(contact.supportHours)).toBeInTheDocument();
  });
});
