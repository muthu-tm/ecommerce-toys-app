'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ProductStatus } from '@romp/contracts';
import { Badge, Button } from '@romp/ui';

import { ApiError, adminApi } from '@/lib/api';
import { statusActions } from '@/lib/product-form';
import { statusLabel, statusTone } from '@/lib/product-view';

/**
 * The publish / unpublish / archive controls for a product.
 *
 * A client component because a status change is an action, not a navigation. It offers only
 * the transitions the state machine permits from the current status (via `statusActions`),
 * so an archived product shows "Restore to draft" rather than a "Publish" the server would
 * reject. On success it refreshes the route so the new status is reflected; on failure it
 * shows the API's own message — a publish blocked by "no active variant" says exactly that.
 */
export function ProductStatusControls({
  productId,
  status,
}: {
  readonly productId: string;
  readonly status: ProductStatus;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<ProductStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const change = (to: ProductStatus): void => {
    setPending(to);
    setError(null);
    void adminApi
      .setStatus(productId, to)
      .then(() => {
        router.refresh();
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : 'Could not change the status.');
      })
      .finally(() => {
        setPending(null);
      });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>
        {statusActions(status).map((action) => (
          <Button
            key={action.to}
            variant={action.to === 'active' ? 'primary' : 'outline'}
            size="sm"
            loading={pending === action.to}
            disabled={pending !== null}
            onClick={() => {
              change(action.to);
            }}
          >
            {action.label}
          </Button>
        ))}
      </div>
      {error !== null ? (
        <p role="alert" className="font-body text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
