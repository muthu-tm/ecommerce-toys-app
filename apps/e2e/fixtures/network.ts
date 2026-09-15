import type { Page } from '@playwright/test';

/**
 * Collects requests the browser Firebase SDK would make to **real** Google hosts.
 *
 * Emulator traffic uses the same Identity Toolkit path but on `127.0.0.1` / `localhost`.
 * Hitting `*.googleapis.com` or `*.firebaseio.com` from a local E2E run is the failure
 * mode where `connect*Emulator` never ran (Next inlined the synthetic API key but not
 * the emulator flag).
 */
export function watchProductionFirebase(page: Page): () => readonly string[] {
  const hits: string[] = [];
  page.on('request', (request) => {
    let host: string;
    try {
      host = new URL(request.url()).hostname;
    } catch {
      return;
    }
    if (host.endsWith('googleapis.com') || host.endsWith('firebaseio.com')) {
      hits.push(request.url());
    }
  });
  return () => hits;
}
