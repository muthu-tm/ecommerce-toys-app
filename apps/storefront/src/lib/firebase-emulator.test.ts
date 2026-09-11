import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  connectAuthToEmulator,
  connectFirestoreToEmulator,
  emulatorConfig,
  parseHostPort,
  resetEmulatorConnections,
} from './firebase-emulator';

/**
 * The client-SDK emulator wiring decision, tested at its pure seam.
 *
 * `firebase-client.ts` itself is coverage-excluded because importing the browser SDK aborts a
 * jsdom worker — so the testable logic lives here: reading the flag and hosts, and calling an
 * injected `connect` exactly once when enabled. The SDK's real `connect*Emulator` functions are
 * passed in at the call site; here we assert the contract those calls honour.
 */

afterEach(() => {
  resetEmulatorConnections();
});

describe('emulatorConfig', () => {
  it('is disabled unless the flag is exactly "true"', () => {
    expect(emulatorConfig({}).enabled).toBe(false);
    expect(emulatorConfig({ NEXT_PUBLIC_USE_FIREBASE_EMULATOR: '1' }).enabled).toBe(false);
    expect(emulatorConfig({ NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'TRUE' }).enabled).toBe(false);
    expect(emulatorConfig({ NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true' }).enabled).toBe(true);
  });

  it('defaults the hosts when the flag is on and no host vars are set', () => {
    const config = emulatorConfig({ NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true' });
    expect(config.authUrl).toBe('http://127.0.0.1:9099');
    expect(config.firestore).toEqual({ host: '127.0.0.1', port: 8181 });
  });

  it('reads explicit host vars', () => {
    const config = emulatorConfig({
      NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true',
      NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9100',
      NEXT_PUBLIC_FIREBASE_FIRESTORE_HOST: 'localhost:9200',
    });
    expect(config.authUrl).toBe('http://localhost:9100');
    expect(config.firestore).toEqual({ host: 'localhost', port: 9200 });
  });
});

describe('parseHostPort', () => {
  it('splits a plain host:port', () => {
    expect(parseHostPort('127.0.0.1:8181', '127.0.0.1:9999')).toEqual({
      host: '127.0.0.1',
      port: 8181,
    });
  });

  it('strips a scheme prefix', () => {
    expect(parseHostPort('http://localhost:9099', '127.0.0.1:9099')).toEqual({
      host: 'localhost',
      port: 9099,
    });
  });

  it('falls back on an empty or missing value', () => {
    expect(parseHostPort(undefined, '127.0.0.1:8181')).toEqual({ host: '127.0.0.1', port: 8181 });
    expect(parseHostPort('   ', '127.0.0.1:8181')).toEqual({ host: '127.0.0.1', port: 8181 });
  });

  it('falls back when the port is not a positive integer', () => {
    expect(parseHostPort('host:notaport', '127.0.0.1:8181')).toEqual({
      host: '127.0.0.1',
      port: 8181,
    });
    expect(parseHostPort('nohostport', '127.0.0.1:8181')).toEqual({
      host: '127.0.0.1',
      port: 8181,
    });
  });
});

describe('connectAuthToEmulator', () => {
  it('connects once with the resolved url when enabled', () => {
    const connect = vi.fn();
    const config = emulatorConfig({ NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true' });
    const instance = {};

    connectAuthToEmulator(instance, connect, config);
    connectAuthToEmulator(instance, connect, config);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(instance, 'http://127.0.0.1:9099', {
      disableWarnings: true,
    });
  });

  it('never connects when disabled', () => {
    const connect = vi.fn();
    connectAuthToEmulator({}, connect, emulatorConfig({}));
    expect(connect).not.toHaveBeenCalled();
  });
});

describe('connectFirestoreToEmulator', () => {
  it('connects once with host and port when enabled', () => {
    const connect = vi.fn();
    const config = emulatorConfig({ NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true' });
    const instance = {};

    connectFirestoreToEmulator(instance, connect, config);
    connectFirestoreToEmulator(instance, connect, config);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(instance, '127.0.0.1', 8181);
  });

  it('never connects when disabled', () => {
    const connect = vi.fn();
    connectFirestoreToEmulator({}, connect, emulatorConfig({}));
    expect(connect).not.toHaveBeenCalled();
  });
});
