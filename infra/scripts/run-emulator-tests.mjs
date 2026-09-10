#!/usr/bin/env node
/**
 * Runs the emulator-backed test suite.
 *
 * Why a wrapper instead of a one-line npm script:
 *
 *   1. `firebase.json` lives at the repo root (App Hosting and the Functions
 *      `source` field both need it there), but this package's scripts run with
 *      cwd = `infra/`. Rather than depend on how firebase-tools resolves
 *      `--config` relative paths — which is version-sensitive — we spawn the CLI
 *      from the repo root explicitly and point Vitest back at this package.
 *
 *   2. The Firestore and Storage emulators need a JVM. Without this preflight,
 *      a machine with no Java fails deep inside firebase-tools with a message
 *      that does not mention how to fix it.
 *
 * Usage:
 *   node scripts/run-emulator-tests.mjs            # single run
 *   node scripts/run-emulator-tests.mjs --watch     # watch mode
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const infraDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(infraDir, '..');

const EMULATORS = 'auth,firestore,storage';
const PROJECT = 'demo-romp'; // `demo-` prefix keeps the emulators fully offline.

function fail(message) {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(1);
}

function assertJavaAvailable() {
  // The exit code is not a reliable signal here. macOS ships a /usr/bin/java
  // stub that exists, is executable, and exits 0 even when no JDK is installed —
  // it just prints "Unable to locate a Java Runtime". So inspect the output and
  // require an actual version banner. `java -version` writes to stderr.
  const probe = spawnSync('java', ['-version'], { encoding: 'utf8' });
  const banner = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
  const looksLikeAJdk = /version\s+"?\d+/.test(banner);

  if (probe.error !== undefined || !looksLikeAJdk) {
    fail(
      [
        'The Firestore and Storage emulators require a Java runtime (JDK 11 or newer), and none was found.',
        '',
        'Install one, then re-run:',
        '  macOS    brew install --cask temurin',
        '  Linux    sudo apt-get install default-jdk',
        '',
        'Already installed but not on PATH? Set JAVA_HOME and add "$JAVA_HOME/bin" to PATH.',
        'CI installs it via actions/setup-java — see .github/actions/setup/action.yml.',
      ].join('\n'),
    );
  }
}

assertJavaAvailable();

const watch = process.argv.includes('--watch');
const vitest = watch ? 'vitest' : 'vitest run';

const result = spawnSync(
  'firebase',
  [
    'emulators:exec',
    '--project',
    PROJECT,
    '--only',
    EMULATORS,
    `${vitest} --root ${JSON.stringify(infraDir)}`,
  ],
  { cwd: repoRoot, stdio: 'inherit', shell: false },
);

if (result.error !== undefined) {
  fail(`Could not start firebase-tools: ${result.error.message}`);
}

process.exit(result.status ?? 1);
