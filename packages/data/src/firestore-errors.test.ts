import { describe, expect, it } from 'vitest';

import { isAlreadyExists } from './firestore-errors';

/**
 * The create-conflict recogniser. It must catch the three shapes ALREADY_EXISTS arrives in — the
 * Admin SDK's numeric gRPC code, the emulator's string code, and a message-only form — and reject
 * everything else, because a false positive would turn an unrelated failure into a spurious
 * "already claimed".
 */
describe('isAlreadyExists', () => {
  it('recognises the Admin SDK numeric gRPC code 6', () => {
    expect(isAlreadyExists(Object.assign(new Error('boom'), { code: 6 }))).toBe(true);
  });

  it('recognises the string code "already-exists"', () => {
    expect(isAlreadyExists({ code: 'already-exists' })).toBe(true);
  });

  it('recognises the message form regardless of code', () => {
    expect(isAlreadyExists(new Error('6 ALREADY_EXISTS: entity already exists'))).toBe(true);
  });

  it('rejects an unrelated error', () => {
    expect(isAlreadyExists(new Error('permission denied'))).toBe(false);
    expect(isAlreadyExists({ code: 5 })).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(isAlreadyExists(null)).toBe(false);
    expect(isAlreadyExists('already exists')).toBe(false);
    expect(isAlreadyExists(undefined)).toBe(false);
  });
});
