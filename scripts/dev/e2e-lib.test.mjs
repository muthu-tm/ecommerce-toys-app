import assert from 'node:assert/strict';
import { test } from 'node:test';

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

/**
 * Pure-helper tests for the orchestrator, run with Node's built-in test runner (no deps).
 * These are the unit-testable seams of Tasks 4 and 5 — the process spawning and network
 * probing are exercised by the manual/Playwright runs, but the decisions are asserted here.
 */

test('emulatorProfileEnv sets the full offline contract', () => {
  const env = emulatorProfileEnv('romp');
  assert.equal(env.STORE_ID, 'romp');
  assert.equal(env.NEXT_PUBLIC_STORE_ID, 'romp');
  assert.equal(env.GCLOUD_PROJECT, 'demo-romp');
  assert.equal(env.FIRESTORE_EMULATOR_HOST, `127.0.0.1:${PORTS.firestore}`);
  assert.equal(env.FIREBASE_AUTH_EMULATOR_HOST, `127.0.0.1:${PORTS.auth}`);
  assert.equal(env.FIREBASE_STORAGE_EMULATOR_HOST, `127.0.0.1:${PORTS.storage}`);
  assert.equal(env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR, 'true');
  assert.equal(env.NEXT_PUBLIC_API_BASE_URL, `http://localhost:${PORTS.api}`);
  assert.equal(env.CORS_ORIGINS, 'http://localhost:3000,http://localhost:3001');
  assert.equal(env.ADMIN_SEED_PASSWORD, 'e2e-admin-password-01');
});

test('emulatorProfileEnv derives the project from the store id', () => {
  const env = emulatorProfileEnv('toybox');
  assert.equal(env.GCLOUD_PROJECT, 'demo-toybox');
  assert.equal(env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, 'demo-toybox');
});

test('emulatorProfileEnv lets overrides win', () => {
  const env = emulatorProfileEnv('romp', { CART_COOKIE_SECRET: 'from-file' });
  assert.equal(env.CART_COOKIE_SECRET, 'from-file');
});

test('firebaseProfileEnv omits all emulator wiring', () => {
  const env = firebaseProfileEnv('romp');
  assert.equal(env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR, undefined);
  assert.equal(env.FIRESTORE_EMULATOR_HOST, undefined);
  assert.equal(env.STORE_ID, 'romp');
  assert.equal(env.NEXT_PUBLIC_API_BASE_URL, `http://localhost:${PORTS.api}`);
});

test('parseDotenv reads KEY=VALUE, skips comments and blanks, strips quotes', () => {
  const parsed = parseDotenv(
    ['# comment', '', 'A=1', 'B = two ', 'C="quoted"', "D='single'", 'noeq'].join('\n'),
  );
  assert.deepEqual(parsed, { A: '1', B: 'two', C: 'quoted', D: 'single' });
});

test('parseArgs defaults to emulator profile and help command', () => {
  assert.deepEqual(parseArgs([]), {
    command: 'help',
    target: undefined,
    profile: 'emulator',
    follow: false,
  });
});

test('parseArgs reads command, target, profile and follow', () => {
  assert.deepEqual(parseArgs(['logs', 'api', '--follow']), {
    command: 'logs',
    target: 'api',
    profile: 'emulator',
    follow: true,
  });
  assert.equal(parseArgs(['start', '--profile=firebase']).profile, 'firebase');
  assert.equal(parseArgs(['start', '--profile=nonsense']).profile, 'emulator');
});

test('probeVerdict classifies up, unhealthy and down', () => {
  assert.deepEqual(probeVerdict({ status: 200 }), { ok: true, state: 'up', detail: 'HTTP 200' });
  assert.deepEqual(probeVerdict({ status: 307 }, [200, 307]), {
    ok: true,
    state: 'up',
    detail: 'HTTP 307',
  });
  assert.equal(probeVerdict({ status: 500 }).state, 'unhealthy');
  assert.equal(probeVerdict({ error: 'ECONNREFUSED' }).state, 'down');
});

test('formatStatusRow marks pass and fail', () => {
  const up = formatStatusRow('api', { ok: true, state: 'up', detail: 'HTTP 200' }, 'http://x');
  const down = formatStatusRow('api', { ok: false, state: 'down', detail: 'err' }, 'http://x');
  assert.match(up, /✓/u);
  assert.match(down, /✗/u);
});

test('allPassed is true only when every verdict is ok', () => {
  assert.equal(allPassed([{ verdict: { ok: true } }, { verdict: { ok: true } }]), true);
  assert.equal(allPassed([{ verdict: { ok: true } }, { verdict: { ok: false } }]), false);
});

test('SERVICES lists the four managed services in start order', () => {
  assert.deepEqual([...SERVICES], ['emulators', 'api', 'storefront', 'admin']);
});
