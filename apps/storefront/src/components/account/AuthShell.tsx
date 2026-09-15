import type { ReactNode } from 'react';

import { Card } from '@romp/ui';

import { Wordmark } from '@/components/Wordmark';

/**
 * The shared frame for the sign-in and register pages.
 *
 * A centred, branded card with the store wordmark above it, so both auth screens read as one
 * cohesive surface rather than a bare form dropped on the page. The form itself (which owns its
 * own `h1` and fields) is passed in as children; this only supplies the surround and the brand
 * mark, so a second store's auth pages are branded as that store with no code change.
 */
export function AuthShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-6 py-8">
      <Wordmark />
      <Card className="w-full bg-surface-elevated p-6 sm:p-8">{children}</Card>
    </div>
  );
}
