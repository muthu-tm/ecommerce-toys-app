import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  connectAuthToEmulator,
  connectStorageToEmulator,
  emulatorConfig,
  parseHostPort,
  resetEmulatorConnections,
} from './firebase-emulator';

/**
 * The backoffice client-SDK emulator wiring, tested at its pure seam.
 *
 * `firebase-client.ts` and `auth.ts` are coverage-excluded because importing the browser SDK
 * aborts a jsdom worker — so the testable logic lives here: reading the flag and hosts, and
 * calling an injected `connect` exactly once when enabled.
 */

afterEach(() => {
  resetEmulatorConnections();
});

describe('emulatorConfig', () => {
  it('is disabled unless the flag is exactly "true"', () => {
    expect(emulatorConfig({}).enabled).toBe(false);
    expect(emulatorConfig({ NEXT_PUBLIC_USE_FIREBASE_EMULATOR: '1' }).enabled).toBe(false);
    expect(emulatorConfig({ NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true' }).enabled).toBe(true);
  });

  it('defaults the hosts when enabled with no host vars', () => {
    const config = emulatorConfig({ NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true' });
    expect(config.authUrl).toBe('http://127.0.0.1:9099');
    expect(config.storage).toEqual({ host: '127.0.0.1', port: 9199 });
  });

  it('reads explicit host vars', () => {
    const config = emulatorConfig({
      NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true',
      NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9100',
      NEXT_PUBLIC_FIREBASE_STORAGE_HOST: 'localhost:9299',
    });
    expect(config.authUrl).toBe('http://localhost:9100');
    expect(config.storage).toEqual({ host: 'localhost', port: 9299 });
  });
});

describe('parseHostPort', () => {
  it('splits a plain host:port and strips a scheme', () => {
    expect(parseHostPort('127.0.0.1:9199', '127.0.0.1:9999')).toEqual({
      host: '127.0.0.1',
      port: 9199,
    });
    expect(parseHostPort('http://localhost:9099', '127.0.0.1:9099')).toEqual({
      host: 'localhost',
      port: 9099,
    });
  });

  it('falls back on empty, missing or malformed values', () => {
    expect(parseHostPort(undefined, '127.0.0.1:9199')).toEqual({ host: '127.0.0.1', port: 9199 });
    expect(parseHostPort('host:notaport', '127.0.0.1:9199')).toEqual({
      host: '127.0.0.1',
      port: 9199,
    });
    expect(parseHostPort('nohostport', '127.0.0.1:9199')).toEqual({
      host: '127.0.0.1',
      port: 9199,
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

describe('connectStorageToEmulator', () => {
  it('connects once with host and port when enabled', () => {
    const connect = vi.fn();
    const config = emulatorConfig({ NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true' });
    const instance = {};

    connectStorageToEmulator(instance, connect, config);
    connectStorageToEmulator(instance, connect, config);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(instance, '127.0.0.1', 9199);
  });

  it('never connects when disabled', () => {
    const connect = vi.fn();
    connectStorageToEmulator({}, connect, emulatorConfig({}));
    expect(connect).not.toHaveBeenCalled();
  });
});
