import { createVitestConfig } from '@romp/config/vitest';

/**
 * Domain tier, not standard, even though this package's name suggests I/O.
 *
 * What lives here is almost entirely pure: the Timestamp codec, the converter
 * factory, and the seed *builders* that turn a store config into documents. The
 * only genuine I/O is `scripts/seed.ts`, which is a thin writer over those builders
 * and is covered by the emulator suite in `infra/` instead.
 *
 * Holding it to the domain bar is deliberate. A converter that silently drops a
 * field, or a seed builder that miscomputes `onHandTotal`, corrupts data rather than
 * failing a request — and corrupt data outlives the deploy that produced it.
 */
export default createVitestConfig({ tier: 'domain' });
