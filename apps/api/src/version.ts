/**
 * Build identity for the health endpoint and log base.
 *
 * Read from the environment the deploy sets, with development fallbacks — the commit SHA
 * comes from CI (`K_REVISION` on Cloud Run / `COMMIT_SHA` in the build), and the version
 * from the package. A health check that reports which build is live is the first thing
 * looked at when something is wrong in one environment and not another.
 */
export const VERSION = process.env.APP_VERSION ?? '0.1.0';

export const COMMIT = process.env.COMMIT_SHA ?? process.env.K_REVISION ?? 'dev';
