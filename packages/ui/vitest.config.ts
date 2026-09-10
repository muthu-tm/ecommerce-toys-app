import react from '@vitejs/plugin-react';
import type { ViteUserConfig } from 'vitest/config';

import { createVitestConfig } from '@romp/config/vitest';

/**
 * UI tier (70%).
 *
 * The lower floor is not laxity: component behaviour is asserted through rendering,
 * keyboard interaction and axe rather than by executing every line, so line coverage
 * measures less here than it does in a domain package. The assertions that matter are
 * "can this be operated by keyboard" and "does axe find a violation".
 *
 * The preset is spread rather than extended, because it does not carry Vite plugins —
 * and JSX needs one.
 */
const base = createVitestConfig({
  tier: 'ui',
  environment: 'jsdom',
  include: ['src/**/*.{test,spec}.{ts,tsx}'],
  setupFiles: ['./src/test-setup.ts'],
});

// Annotated rather than inferred: the plugin's own option types are not exported, so an
// inferred default export cannot be named and `tsc` rejects it.
const config: ViteUserConfig = {
  ...base,
  plugins: [react()],
};

export default config;
