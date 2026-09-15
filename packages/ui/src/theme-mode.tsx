'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { cn } from './cn';
import { FOCUS_RING } from './focus';
import { TRANSITION } from './motion';

/**
 * Light/dark theme mode.
 *
 * The store config emits both palettes and a `prefers-color-scheme` fallback (see
 * `renderThemeCss`). This module is the client half: it reads and writes the visitor's
 * explicit choice, sets `data-theme` on `<html>`, and persists it. The two halves meet at
 * one attribute — `data-theme` on the document element — which the CSS `[data-theme=…]`
 * selectors key off.
 *
 * Two properties are load-bearing:
 *
 *  - **No flash of the wrong theme.** `themeInitScript` runs before first paint (it is
 *    injected as a blocking inline script in the document head) and sets `data-theme` from
 *    storage synchronously, so the correct palette is applied before any pixels are drawn.
 *    React then hydrates against the value already there.
 *  - **OS preference until a choice is made.** When storage is empty, the init script sets
 *    nothing, so `:root` (the store's default palette) and the `prefers-color-scheme` media
 *    query decide — exactly the CSS behaviour. Only an explicit toggle writes storage and
 *    pins `data-theme`.
 */

export type ThemeMode = 'light' | 'dark';

/** The localStorage key the init script and the provider agree on. */
export const THEME_STORAGE_KEY = 'romp-theme';

interface ThemeModeState {
  /**
   * The resolved mode currently applied, or null before the client has resolved it (SSR
   * and the first render). Consumers that must not flip an icon prematurely branch on null.
   */
  readonly mode: ThemeMode | null;
  readonly setMode: (mode: ThemeMode) => void;
  readonly toggle: () => void;
}

const ThemeModeContext = createContext<ThemeModeState>({
  mode: null,
  setMode: () => undefined,
  toggle: () => undefined,
});

/**
 * The inline script that prevents a flash of the wrong theme.
 *
 * Rendered into `<head>` via `dangerouslySetInnerHTML` in each app's root layout, before
 * the stylesheet is applied. It is tiny, dependency-free, and wrapped in try/catch so a
 * storage exception (private mode, disabled cookies) degrades to the CSS default rather
 * than throwing during head parsing. It only ever *sets* `data-theme` when the visitor has
 * an explicit stored choice; otherwise it leaves the document alone so the OS preference
 * wins.
 */
export const themeInitScript = `(function(){try{var m=localStorage.getItem('${THEME_STORAGE_KEY}');if(m==='light'||m==='dark'){document.documentElement.setAttribute('data-theme',m);}}catch(e){}})();`;

/** Reads the current explicit choice from storage, or null when none is set. */
function readStoredMode(): ThemeMode | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

/** The mode actually in effect: the stored choice, else the OS preference. */
function resolveEffectiveMode(): ThemeMode {
  const stored = readStoredMode();
  if (stored !== null) return stored;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
}

export interface ThemeProviderProps {
  readonly children: ReactNode;
}

/**
 * Provides the current theme mode and the controls to change it.
 *
 * Mounted once, high in each app's tree. It resolves the effective mode after mount (the
 * server cannot know it), then keeps `data-theme` and storage in sync when the visitor
 * toggles, and follows the OS preference live *only while no explicit choice exists*.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode | null>(null);

  // Resolve the effective mode once the client is running.
  useEffect(() => {
    setModeState(resolveEffectiveMode());
  }, []);

  // Follow the OS preference live, but only when the visitor has made no explicit choice —
  // an explicit choice pins the theme regardless of what the OS does.
  useEffect(() => {
    let media: MediaQueryList;
    try {
      media = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const onChange = (event: MediaQueryListEvent): void => {
      if (readStoredMode() === null) setModeState(event.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable — the choice holds for this session via the attribute below.
    }
    document.documentElement.setAttribute('data-theme', next);
  }, []);

  const toggle = useCallback(() => {
    setMode(resolveEffectiveMode() === 'dark' ? 'light' : 'dark');
  }, [setMode]);

  const value = useMemo<ThemeModeState>(() => ({ mode, setMode, toggle }), [mode, setMode, toggle]);

  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>;
}

/** The theme mode state, from the nearest `ThemeProvider`. */
export function useThemeMode(): ThemeModeState {
  return useContext(ThemeModeContext);
}

export interface ThemeToggleProps {
  readonly className?: string;
  /** Accessible-name prefix; the current/target mode is appended. Defaults sensibly. */
  readonly label?: string;
}

/**
 * A sun/moon button that flips the theme.
 *
 * A real `<button>` with a mode-aware accessible name ("Switch to light theme"), so a
 * screen-reader user knows what pressing it does, not merely that a toggle exists. The
 * glyph is decorative. Before the client resolves the mode it renders a neutral,
 * still-labelled control rather than guessing — no icon flip on hydration.
 */
export function ThemeToggle({ className, label }: ThemeToggleProps) {
  const { mode, toggle } = useThemeMode();

  const target = mode === 'dark' ? 'light' : 'dark';
  const accessibleName =
    mode === null ? (label ?? 'Switch theme') : (label ?? `Switch to ${target} theme`);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={accessibleName}
      aria-pressed={mode === null ? undefined : mode === 'dark'}
      className={cn(
        'inline-flex size-11 items-center justify-center rounded-md text-text-primary',
        'hover:bg-surface-alt active:bg-surface-deep',
        TRANSITION,
        FOCUS_RING,
        className,
      )}
    >
      {/* Sun when currently dark (press → light), moon when currently light (press → dark). */}
      {mode === 'dark' ? (
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true" fill="none">
          <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="2" />
          <path
            d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true" fill="none">
          <path
            d="M20 13.5A8 8 0 1 1 10.5 4a6.3 6.3 0 0 0 9.5 9.5z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
