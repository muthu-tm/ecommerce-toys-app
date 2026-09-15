import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { expectNoAxeViolations } from './test-axe';
import {
  THEME_STORAGE_KEY,
  ThemeProvider,
  ThemeToggle,
  themeInitScript,
  useThemeMode,
} from './theme-mode';

function ModeReadout() {
  const { mode } = useThemeMode();
  return <span data-testid="mode">{mode ?? 'unresolved'}</span>;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('themeInitScript', () => {
  it('reads the shared storage key and pins data-theme, wrapped so it cannot throw', () => {
    // The script is a raw string injected into <head> before paint, so it is asserted
    // structurally rather than executed (executing it would be an implied eval). What
    // matters: it keys off the same storage key the provider writes, sets `data-theme`
    // on the document element, and is guarded so a storage exception cannot break head
    // parsing.
    expect(themeInitScript).toContain(THEME_STORAGE_KEY);
    expect(themeInitScript).toContain("setAttribute('data-theme'");
    expect(themeInitScript).toContain('try');
    expect(themeInitScript).toContain('catch');
    // It only pins the two valid modes, never an arbitrary stored value.
    expect(themeInitScript).toContain("'light'");
    expect(themeInitScript).toContain("'dark'");
  });
});

describe('ThemeProvider + ThemeToggle', () => {
  it('resolves to the OS preference when no choice is stored', () => {
    // matchMedia is stubbed to matches:false → prefers-color-scheme:dark is false → light.
    render(
      <ThemeProvider>
        <ModeReadout />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('light');
  });

  it('starts from the stored choice', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(
      <ThemeProvider>
        <ModeReadout />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
  });

  it('toggles, persists, and sets data-theme on the document', async () => {
    render(
      <ThemeProvider>
        <ModeReadout />
        <ThemeToggle />
      </ThemeProvider>,
    );

    // Starts light (OS default in tests). The button therefore offers dark.
    const button = screen.getByRole('button', { name: 'Switch to dark theme' });
    await act(async () => {
      await userEvent.click(button);
    });

    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    // Its name now offers the way back.
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
  });

  it('exposes aria-pressed reflecting dark mode', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('is accessible and uses token styling only', async () => {
    const { container } = render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/iu);
    await expectNoAxeViolations(container);
  });
});
