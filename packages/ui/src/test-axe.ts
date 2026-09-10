import axe from 'axe-core';
import { expect } from 'vitest';

/**
 * Runs axe against a rendered container and fails with the specific violations.
 *
 * A plain helper rather than a custom matcher: the failure message is the whole value
 * here, and a helper that formats it exactly how we want is simpler than extending
 * `expect`.
 *
 * What this does and does not prove. axe catches a real class of defect — a missing
 * accessible name, a bad `aria-*` combination, a label with no control — cheaply and on
 * every run. It cannot tell whether a flow is *usable*: that needs keyboard tests, which
 * these components also have, and manual testing with a screen reader, which no automated
 * check replaces.
 */
export async function expectNoAxeViolations(
  container: HTMLElement,
  options: { readonly rules?: Record<string, { enabled: boolean }> } = {},
): Promise<void> {
  const results = await axe.run(container, {
    // jsdom has no layout, so anything depending on computed colour or geometry cannot
    // be evaluated here. Colour contrast is gated separately and far more strictly, in
    // @romp/store-config, against the palette itself.
    rules: {
      'color-contrast': { enabled: false },
      ...options.rules,
    },
  });

  if (results.violations.length > 0) {
    const detail = results.violations
      .map((violation) => {
        const nodes = violation.nodes.map((node) => `      ${node.html}`).join('\n');
        return `  ${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help}\n${nodes}`;
      })
      .join('\n');

    expect.fail(`axe found ${String(results.violations.length)} violation(s):\n${detail}`);
  }
}
