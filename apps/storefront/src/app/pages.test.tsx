import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { brand, content, locale, theme } from '@/lib/store';

import RouteError from './error';
import RootLayout, { metadata, viewport } from './layout';
import NotFound from './not-found';
import HomePage from './page';

async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  });

  if (results.violations.length > 0) {
    expect.fail(results.violations.map((v) => `${v.id}: ${v.help}`).join('\n'));
  }
}

describe('RootLayout', () => {
  /**
   * Rendered to static markup rather than mounted: the layout returns `<html>`, which
   * cannot be nested inside a test container. This is also exactly how the server renders
   * it, so it is the honest way to assert on the document shell.
   */
  const markup = renderToStaticMarkup(
    <RootLayout>
      <p>Page content</p>
    </RootLayout>,
  );

  it('sets lang from the configured locale', () => {
    // A store serving another locale must announce itself correctly to screen readers and
    // translation tools.
    expect(markup).toContain(`lang="${locale.locale}"`);
  });

  it('puts the generated font class on the document root', () => {
    // The class comes from the generated fonts module, stubbed here. That the module
    // requests the right families, weights and CSS variables is asserted directly against
    // `renderFontsModule` in @romp/store-config.
    expect(markup).toMatch(/<html[^>]*class="[^"]*font-stub-display/u);
    expect(markup).toContain('font-stub-body');
  });

  it('renders the skip link before the header', () => {
    // It must be the first tabbable element, or a keyboard user is marched through the
    // whole header on every page.
    const skipIndex = markup.indexOf('Skip to content');
    const headerIndex = markup.indexOf('<header');

    expect(skipIndex).toBeGreaterThan(-1);
    expect(skipIndex).toBeLessThan(headerIndex);
  });

  it('exposes a focusable main landmark matching the skip target', () => {
    expect(markup).toContain('id="main-content"');
    expect(markup).toContain('href="#main-content"');
    // tabIndex -1 so the skip actually moves focus rather than only scrolling.
    expect(markup).toMatch(/<main[^>]*tabindex="-1"/u);
  });

  it('renders the children inside main', () => {
    expect(markup).toContain('Page content');
  });

  it('renders header and footer landmarks', () => {
    expect(markup).toContain('<header');
    expect(markup).toContain('<footer');
  });
});

describe('metadata', () => {
  it('is built from store config, not literals', () => {
    expect(metadata.title).toMatchObject({
      default: `${brand.name} — ${brand.tagline}`,
      template: `%s · ${brand.name}`,
    });
    expect(metadata.description).toBe(brand.tagline);
    expect(metadata.applicationName).toBe(brand.name);
  });

  it('sets an absolute metadataBase so share previews resolve', () => {
    // Without it Next resolves OG images against localhost — fine locally, broken in
    // production, and invisible until someone shares a link.
    expect(metadata.metadataBase).toBeInstanceOf(URL);
  });

  it('points the favicon and OG image at the generated brand assets', () => {
    expect(JSON.stringify(metadata.icons)).toContain('/brand/favicon.svg');
    expect(JSON.stringify(metadata.openGraph)).toContain('/brand/og-fallback.png');
  });
});

describe('viewport', () => {
  it('does not block zoom', () => {
    // Blocking pinch-zoom is a WCAG failure and stops people reading small print.
    expect(viewport.maximumScale).toBeUndefined();
    expect(viewport.userScalable).toBeUndefined();
  });

  it('takes the browser chrome colour from config', () => {
    expect(viewport.themeColor).toBe(theme.colors.surfaceDeep);
  });
});

describe('HomePage', () => {
  it('is accessible', async () => {
    const { container } = render(<HomePage />);

    await expectNoAxeViolations(container);
  });

  it('renders the configured hero copy', () => {
    render(<HomePage />);
    const { hero } = content.home;

    expect(screen.getByRole('heading', { level: 1, name: hero.headline })).toBeInTheDocument();
    expect(screen.getByText(hero.eyebrow)).toBeInTheDocument();
    expect(screen.getByText(hero.subcopy)).toBeInTheDocument();
  });

  it('renders both configured calls to action with their configured hrefs', () => {
    render(<HomePage />);
    const { hero } = content.home;

    expect(screen.getByRole('link', { name: hero.primaryCta.label })).toHaveAttribute(
      'href',
      hero.primaryCta.href,
    );
    expect(screen.getByRole('link', { name: hero.secondaryCta.label })).toHaveAttribute(
      'href',
      hero.secondaryCta.href,
    );
  });

  it('has exactly one h1', () => {
    render(<HomePage />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('generates one tile per configured age band', () => {
    // Changing the configured bands changes the grid — no code edit.
    render(<HomePage />);

    for (const band of content.ageBands) {
      const link = screen.getByRole('link', { name: new RegExp(band.label, 'u') });
      expect(link).toHaveAttribute('href', `/age/${band.value}`);
      expect(screen.getByText(band.note)).toBeInTheDocument();
    }
  });

  it('renders every configured trust badge', () => {
    render(<HomePage />);

    for (const badge of content.home.trustBadges) {
      expect(screen.getByText(badge.title)).toBeInTheDocument();
      expect(screen.getByText(badge.description)).toBeInTheDocument();
    }
  });

  it('labels each section with a heading', () => {
    render(<HomePage />);

    expect(
      screen.getByRole('heading', { level: 2, name: content.home.ageSectionTitle }),
    ).toBeInTheDocument();
  });
});

describe('NotFound', () => {
  it('is accessible and reuses the configured empty-state copy', async () => {
    // A store writes that message once rather than twice.
    const { container } = render(<NotFound />);
    const { noResults } = content.emptyStates;

    expect(screen.getByRole('heading', { level: 1, name: noResults.title })).toBeInTheDocument();
    expect(screen.getByText(noResults.body)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('offers a route onward', () => {
    // A dead end with no link is how a 404 becomes an exit.
    render(<NotFound />);

    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
  });
});

describe('RouteError', () => {
  it('offers both retry and a way out', async () => {
    // A boundary with only "try again" traps someone whose error is not transient.
    const reset = vi.fn();
    const { container } = render(<RouteError error={new Error('boom')} reset={reset} />);

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
    await expectNoAxeViolations(container);
  });

  it('does not show the error message to the customer', () => {
    // A server component's error message can contain internal detail.
    render(
      <RouteError
        error={new Error('Firestore: PERMISSION_DENIED on /orders/abc')}
        reset={vi.fn()}
      />,
    );

    expect(screen.queryByText(/PERMISSION_DENIED/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/orders\/abc/u)).not.toBeInTheDocument();
  });

  it('shows the digest so support can correlate it', () => {
    const error = Object.assign(new Error('boom'), { digest: 'abc123' });
    render(<RouteError error={error} reset={vi.fn()} />);

    expect(screen.getByText('abc123')).toBeInTheDocument();
  });

  it('omits the reference when there is no digest', () => {
    render(<RouteError error={new Error('boom')} reset={vi.fn()} />);

    expect(screen.queryByText(/Reference:/u)).not.toBeInTheDocument();
  });
});
