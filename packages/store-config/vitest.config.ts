import { createVitestConfig } from '@romp/config/vitest';

// Domain tier. The contrast validator and the token emitter are the two things that
// decide whether a rebrand ships something unreadable, and both are pure functions.
export default createVitestConfig({ tier: 'domain' });
