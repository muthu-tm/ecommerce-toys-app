import { createVitestConfig } from '@romp/config/vitest';

/**
 * Domain tier.
 *
 * Everything here is pure and identity-critical: the phone normaliser and alias
 * derivation are the only reason two code paths agree on who a customer is, and the
 * password policy is the gate on account security. A silent regression in any of them
 * corrupts identity or weakens a credential — failures that outlive the deploy — so it
 * is held to the domain bar (95/95/90/95), not the standard one.
 */
export default createVitestConfig({ tier: 'domain' });
