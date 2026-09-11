#!/usr/bin/env node
/**
 * Local E2E orchestrator — one command to run the whole ROMP stack for end-to-end testing.
 *
 *   pnpm e2e start            start emulators + seed + api + storefront + admin
 *   pnpm e2e stop             stop everything, clean pid files
 *   pnpm e2e restart          stop then start
 *   pnpm e2e status           per-service liveness table
 *   pnpm e2e test             quick smoke: liveness + a shallow functional pass
 *   pnpm e2e logs <service>   print (or -f follow) a service log
 *
 *   --profile emulator   (default) fully offline against the Firebase emulators
 *   --profile firebase   real Firebase project (web config from your env/.env.local)
 *
 * Why a Node script rather than a process manager: it needs a Java preflight, an ordered
 * start (emulators must be up and seeded before the apps read them), health-gated waits, and
 * a status/stop story keyed on pid files — the same shape as `infra/scripts/run-emulator-tests.mjs`,
 * extended to long-lived processes. Services run detached, logging to `.e2e/logs/`, with pids
 * in `.e2e/pids/`, so `start` returns your shell and `stop` finds them again.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PORTS,
  SERVICES,
  allPassed,
  emulatorProfileEnv,
  firebaseProfileEnv,
  formatStatusRow,
  parseArgs,
  parseDotenv,
  probeVerdict,
} from './e2e-lib.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const runDir = resolve(repoRoot, '.e2e');
const pidDir = resolve(runDir, 'pids');
const logDir = resolve(runDir, 'logs');

const STORE_ID = process.env.STORE_ID ?? 'romp';
const EMULATORS = 'auth,firestore,storage,ui';
const PROJECT = `demo-${STORE_ID}`;

function out(message = '') {
  process.stdout.write(`${message}\n`);
}
function fail(message) {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(1);
}

// --- preflight -------------------------------------------------------------

/**
 * Reuses the exact Java-detection logic from `infra/scripts/run-emulator-tests.mjs`: the
 * macOS `/usr/bin/java` stub exits 0 with no JDK installed, so inspect the version banner,
 * not the exit code.
 */
function assertJavaAvailable() {
  const probe = spawnSync('java', ['-version'], { encoding: 'utf8' });
  const banner = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
  if (probe.error !== undefined || !/version\s+"?\d+/.test(banner)) {
    fail(
      [
        'The Firestore and Storage emulators require a Java runtime (JDK 11+), and none was found.',
        '',
        'Install one, then re-run:',
        '  macOS    brew install --cask temurin',
        '  Linux    sudo apt-get install default-jdk',
      ].join('\n'),
    );
  }
}

// --- profile env -----------------------------------------------------------

function loadOverrides() {
  const override = resolve(repoRoot, '.env.e2e');
  if (!existsSync(override)) return {};
  return parseDotenv(readFileSync(override, 'utf8'));
}

function profileEnv(profile) {
  if (profile === 'firebase') {
    return firebaseProfileEnv(STORE_ID, loadOverrides());
  }
  return emulatorProfileEnv(STORE_ID, loadOverrides());
}

// --- pid / log bookkeeping -------------------------------------------------

function ensureDirs() {
  mkdirSync(pidDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });
}
function pidFile(name) {
  return resolve(pidDir, `${name}.pid`);
}
function logFile(name) {
  return resolve(logDir, `${name}.log`);
}
function readPid(name) {
  const file = pidFile(name);
  if (!existsSync(file)) return null;
  const pid = Number(readFileSync(file, 'utf8').trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawns a long-lived service detached, its output redirected to a log file, and records the
 * pid. Detached + unref so the orchestrator can exit while the service keeps running; the pid
 * file is how `stop`/`status` find it later.
 */
function startService(name, command, args, env) {
  const existing = readPid(name);
  if (existing !== null && isAlive(existing)) {
    out(`  · ${name} already running (pid ${String(existing)})`);
    return;
  }
  const fd = openSync(logFile(name), 'a');
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ['ignore', fd, fd],
  });
  writeFileSync(pidFile(name), String(child.pid));
  child.unref();
  out(
    `  ▸ ${name} started (pid ${String(child.pid)}) → ${logFile(name).replace(repoRoot + '/', '')}`,
  );
}

function stopService(name) {
  const pid = readPid(name);
  if (pid === null) {
    out(`  · ${name} not tracked`);
    return;
  }
  if (isAlive(pid)) {
    try {
      // Negative pid kills the whole process group (detached leader), catching child
      // processes a dev server spawns.
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
    out(`  ■ ${name} stopped (pid ${String(pid)})`);
  } else {
    out(`  · ${name} was not running`);
  }
  rmSync(pidFile(name), { force: true });
}

// --- health probes ---------------------------------------------------------

async function httpProbe(url, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return { status: res.status };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** The endpoints each service answers liveness on, and the acceptable status codes. */
function probeTargets() {
  return [
    { name: 'emulators', url: `http://127.0.0.1:${PORTS.hub}/`, accept: [200] },
    { name: 'api', url: `http://127.0.0.1:${PORTS.api}/v1/health`, accept: [200] },
    { name: 'storefront', url: `http://127.0.0.1:${PORTS.storefront}/`, accept: [200] },
    { name: 'admin', url: `http://127.0.0.1:${PORTS.admin}/`, accept: [200, 307, 308] },
  ];
}

async function collectStatus() {
  const results = [];
  for (const target of probeTargets()) {
    const raw = await httpProbe(target.url);
    results.push({ ...target, verdict: probeVerdict(raw, target.accept) });
  }
  return results;
}

/** Polls one URL until it answers acceptably or the deadline passes. */
async function waitForReady(name, url, accept, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write(`  … waiting for ${name} `);
  for (;;) {
    const raw = await httpProbe(url, 2000);
    if (probeVerdict(raw, accept).ok) {
      out('ready');
      return true;
    }
    if (Date.now() > deadline) {
      out('timed out');
      return false;
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 1500));
  }
}

// --- seeding ---------------------------------------------------------------

function seed(env) {
  out('  seeding catalogue…');
  const cat = spawnSync('pnpm', ['seed', '--project', PROJECT, '--reset'], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  if (cat.status !== 0) fail('Catalogue seed failed.');

  out('  seeding admins…');
  const admins = spawnSync('pnpm', ['seed:admins'], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  if (admins.status !== 0) fail('Admin seed failed.');
}

// --- commands --------------------------------------------------------------

async function cmdStart(profile) {
  ensureDirs();
  const env = profileEnv(profile);

  if (profile === 'emulator') {
    assertJavaAvailable();
    out('Starting Firebase emulators…');
    startService(
      'emulators',
      'firebase',
      ['emulators:start', '--project', PROJECT, '--only', EMULATORS],
      env,
    );
    const hubReady = await waitForReady('emulators', `http://127.0.0.1:${PORTS.hub}/`, [200]);
    if (!hubReady) fail('Emulators did not become ready. Check .e2e/logs/emulators.log');
    seed(env);
  } else {
    out('Profile: firebase (real project) — skipping emulators and seeding.');
  }

  out('Starting API…');
  startService('api', 'pnpm', ['--filter', '@romp/api', 'dev'], env);
  out('Starting storefront…');
  startService('storefront', 'pnpm', ['--filter', '@romp/storefront', 'dev'], env);
  out('Starting admin…');
  startService('admin', 'pnpm', ['--filter', '@romp/admin', 'dev'], env);

  await waitForReady('api', `http://127.0.0.1:${PORTS.api}/v1/health`, [200]);
  await waitForReady('storefront', `http://127.0.0.1:${PORTS.storefront}/`, [200]);
  await waitForReady('admin', `http://127.0.0.1:${PORTS.admin}/`, [200, 307, 308]);

  out('');
  await cmdStatus();
  out('');
  out(
    'Stack is up. Storefront http://localhost:3000 · Admin http://localhost:3001 · Emulator UI http://localhost:4000',
  );
  out('Quick check any time: pnpm e2e test   ·   Tear down: pnpm e2e stop');
}

function cmdStop() {
  out('Stopping services…');
  // Reverse of start order.
  for (const name of [...SERVICES].reverse()) {
    stopService(name);
  }
  out('Done.');
}

async function cmdStatus() {
  out('Service status:');
  const results = await collectStatus();
  for (const r of results) {
    out(formatStatusRow(r.name, r.verdict, r.url));
  }
  return results;
}

function cmdLogs(target, follow) {
  if (target === undefined || !SERVICES.includes(target)) {
    fail(`Usage: pnpm e2e logs <${SERVICES.join('|')}> [--follow]`);
  }
  const file = logFile(target);
  if (!existsSync(file)) fail(`No log for ${target} yet (has it been started?).`);
  const args = follow ? ['-f', file] : [file];
  const tail = spawnSync('tail', follow ? args : ['-n', '200', file], { stdio: 'inherit' });
  process.exit(tail.status ?? 0);
}

function printHelp() {
  out('ROMP local E2E orchestrator');
  out('');
  out('  pnpm e2e start [--profile emulator|firebase]');
  out('  pnpm e2e stop');
  out('  pnpm e2e restart [--profile ...]');
  out('  pnpm e2e status');
  out('  pnpm e2e test');
  out(`  pnpm e2e logs <${SERVICES.join('|')}> [--follow]`);
}

// --- entry -----------------------------------------------------------------

async function main() {
  const { command, target, profile, follow } = parseArgs(process.argv.slice(2));
  switch (command) {
    case 'start':
      await cmdStart(profile);
      break;
    case 'stop':
      cmdStop();
      break;
    case 'restart':
      cmdStop();
      await cmdStart(profile);
      break;
    case 'status': {
      const results = await cmdStatus();
      process.exit(allPassed(results) ? 0 : 1);
      break;
    }
    case 'test':
      await (await import('./e2e-test.mjs')).runQuickTest({ PORTS, STORE_ID });
      break;
    case 'logs':
      cmdLogs(target, follow);
      break;
    default:
      printHelp();
  }
}

main().catch((error) => {
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
