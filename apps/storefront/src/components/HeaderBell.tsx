'use client';

import { useAuth } from '@/lib/auth-context';

import { NotificationBell } from './NotificationBell';

/**
 * The header's notification bell, wired to the live auth state.
 *
 * `SiteHeader` is a server component and cannot read the auth context, so this thin client wrapper
 * bridges the two: it reads `{ uid }` from `useAuth` and hands it to the bell, which activates its
 * realtime subscription for a signed-in customer and renders the signed-out link otherwise. Keeping
 * `NotificationBell` a pure `uid`-prop component leaves it testable in isolation.
 */
export function HeaderBell() {
  const { uid } = useAuth();
  return <NotificationBell uid={uid} />;
}
