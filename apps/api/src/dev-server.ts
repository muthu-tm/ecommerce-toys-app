import { buildApp } from './app';
import { buildDeps } from './bootstrap';

/**
 * Local development server.
 *
 * Runs the same Fastify app the Cloud Function wraps, on a plain port, so `pnpm --filter
 * @romp/api dev` gives a working API against the emulator without the Functions runtime.
 * Point the Admin SDK at the emulator by exporting `FIREBASE_AUTH_EMULATOR_HOST` and
 * `FIRESTORE_EMULATOR_HOST` before running.
 */

const PORT = Number(process.env.PORT ?? 8787);

async function main(): Promise<void> {
  const app = await buildApp(buildDeps());
  await app.listen({ port: PORT, host: '0.0.0.0' });
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console -- the dev server has no logger wired before boot
  console.error(error);
  process.exit(1);
});
