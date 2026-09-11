import { notFound } from 'next/navigation';

import { OrderDetail } from '@/components/OrderDetail';
import { getOrderForAdmin } from '@/server/orders';

/**
 * The backoffice order detail.
 *
 * A server component reading the order and its audit trail as a staff caller. A missing order is a
 * not-found rather than a throw. Dynamic, so a fulfilment advance or a cancellation is reflected on
 * the next load.
 */
export const dynamic = 'force-dynamic';

export default async function OrderPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getOrderForAdmin(id);
  if (result === null) notFound();

  return <OrderDetail order={result.order} events={result.events} />;
}
