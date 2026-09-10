/**
 * An empty module.
 *
 * Aliased in place of `server-only` under test. That package exports nothing and exists
 * only to throw a build error when a server module is imported into a client bundle —
 * a protection enforced by `next build`, not by the test runner, and one that would
 * otherwise make a server component unrenderable in jsdom.
 */
export {};
