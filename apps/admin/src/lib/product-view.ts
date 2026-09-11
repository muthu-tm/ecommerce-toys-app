import type { ProductStatus } from '@romp/contracts';
import type { BadgeTone } from '@romp/ui';


/**
 * View helpers for rendering product status in the backoffice.
 *
 * Pure and tested: the mapping from a status to a badge tone and a human label is the kind
 * of thing that drifts silently (a new status with no case falls through to a default that
 * looks fine), so it is asserted rather than eyeballed.
 */

/** The badge tone for each product status. */
export function statusTone(status: ProductStatus): BadgeTone {
  switch (status) {
    case 'active':
      return 'success';
    case 'draft':
      return 'neutral';
    case 'archived':
      return 'warning';
  }
}

/** The human label for each product status. */
export function statusLabel(status: ProductStatus): string {
  switch (status) {
    case 'active':
      return 'Published';
    case 'draft':
      return 'Draft';
    case 'archived':
      return 'Archived';
  }
}
