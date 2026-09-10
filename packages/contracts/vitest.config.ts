import { createVitestConfig } from '@romp/config/vitest';

// Domain tier: pure schemas and arithmetic with no I/O. Money and the state
// machines are the two things most expensive to get wrong, and both are testable
// exhaustively, so this package is held to the highest floor.
export default createVitestConfig({ tier: 'domain' });
