import { createVitestConfig } from '@romp/config/vitest';

// Domain tier despite touching a logger: redaction and error mapping are pure
// functions, and they are the controls that stop PII reaching logs and stop
// internal detail reaching clients. Both deserve the highest floor.
export default createVitestConfig({ tier: 'domain' });
