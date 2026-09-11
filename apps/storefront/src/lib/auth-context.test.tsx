import { render, screen, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * The auth context subscribes once to sign-in changes and shares `{ uid, ready }`. `onUidChanged`
 * is mocked so the test drives the auth state without the browser SDK.
 */

let listener: ((uid: string | null) => void) | null = null;
const onUidChanged = vi.hoisted(() => vi.fn());

vi.mock('./firebase-client', () => ({
  onUidChanged: (fn: (uid: string | null) => void) => {
    onUidChanged(fn);
    return () => {
      /* unsubscribe */
    };
  },
}));

const { AuthProvider, useAuth } = await import('./auth-context');

function Probe() {
  const { uid, ready } = useAuth();
  return <span>{ready ? `uid:${uid ?? 'none'}` : 'loading'}</span>;
}

describe('AuthProvider', () => {
  it('starts not-ready, then reflects the resolved uid', () => {
    onUidChanged.mockImplementation((fn: (uid: string | null) => void) => {
      listener = fn;
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    // Before the first callback lands, the state is loading.
    expect(screen.getByText('loading')).toBeInTheDocument();

    act(() => {
      listener?.('cust-1');
    });
    expect(screen.getByText('uid:cust-1')).toBeInTheDocument();

    act(() => {
      listener?.(null);
    });
    expect(screen.getByText('uid:none')).toBeInTheDocument();
  });
});
