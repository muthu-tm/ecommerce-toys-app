import type { Auth, UserRecord } from 'firebase-admin/auth';
import { describe, expect, it } from 'vitest';

import { seedAdmin } from './admin-seed';

const CONFIG = { storeId: 'test-store', defaultPhoneRegion: 'IN' };

/**
 * A fake Auth that records claim and user writes, and can be seeded with an existing user.
 * Only the methods the seed core calls are implemented.
 */
function fakeAuth(existing?: Partial<UserRecord>) {
  const state = {
    claims: undefined as Record<string, unknown> | undefined,
    created: undefined as { email: string; password: string } | undefined,
    updatedDisplayName: undefined as string | undefined,
  };
  const auth = {
    getUserByEmail: (email: string) =>
      existing !== undefined
        ? Promise.resolve({ uid: 'existing-uid', email, ...existing } as UserRecord)
        : Promise.reject(new Error('not found')),
    createUser: (props: { email: string; password: string; displayName: string }) => {
      state.created = { email: props.email, password: props.password };
      return Promise.resolve({ uid: 'new-uid' } as UserRecord);
    },
    setCustomUserClaims: (_uid: string, claims: Record<string, unknown>) => {
      state.claims = claims;
      return Promise.resolve();
    },
    updateUser: (_uid: string, props: { displayName?: string }) => {
      state.updatedDisplayName = props.displayName;
      return Promise.resolve({} as UserRecord);
    },
  } as unknown as Auth;
  return { auth, state };
}

describe('seedAdmin', () => {
  it('creates a new email admin with a one-time password and role claim', async () => {
    const { auth, state } = fakeAuth();
    const result = await seedAdmin(
      auth,
      CONFIG,
      { identifier: 'owner@example.com', displayName: 'Owner', role: 'owner' },
      () => 'generated-password',
    );

    expect(result.created).toBe(true);
    expect(result.loginEmail).toBe('owner@example.com');
    expect(result.initialPassword).toBe('generated-password');
    expect(state.created?.password).toBe('generated-password');
    expect(state.claims).toEqual({ role: 'owner', mustRotate: true });
  });

  it('derives the phone alias login email for a mobile admin', async () => {
    const { auth } = fakeAuth();
    const result = await seedAdmin(
      auth,
      CONFIG,
      { identifier: '9845021174', displayName: 'Staff', role: 'staff' },
      () => 'pw',
    );

    expect(result.loginEmail).toBe('p.919845021174@auth.test-store.internal');
    expect(result.role).toBe('staff');
  });

  it('reconciles an existing admin without touching their password', async () => {
    const { auth, state } = fakeAuth({ displayName: 'Old Name', customClaims: { role: 'staff' } });
    const result = await seedAdmin(
      auth,
      CONFIG,
      { identifier: 'owner@example.com', displayName: 'New Name', role: 'owner' },
      () => 'should-not-be-used',
    );

    expect(result.created).toBe(false);
    expect(result.initialPassword).toBeUndefined();
    // No new user was created.
    expect(state.created).toBeUndefined();
    // The role claim is upgraded, and the display name reconciled.
    expect(state.claims).toEqual({ role: 'owner' });
    expect(state.updatedDisplayName).toBe('New Name');
  });

  it('leaves the display name alone when it already matches', async () => {
    const { auth, state } = fakeAuth({ displayName: 'Same', customClaims: { role: 'owner' } });
    await seedAdmin(
      auth,
      CONFIG,
      { identifier: 'owner@example.com', displayName: 'Same', role: 'owner' },
      () => 'pw',
    );
    expect(state.updatedDisplayName).toBeUndefined();
  });
});
