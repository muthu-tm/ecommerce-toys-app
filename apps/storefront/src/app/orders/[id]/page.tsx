import { OrderConfirmation } from '@/components/OrderConfirmation';

/**
 * The order confirmation page: `/orders/{id}`.
 *
 * Dynamic and never cached — an order is the customer's own record, read through the API with their
 * session. The page is a thin server shell; `OrderConfirmation` fetches the order and renders the
 * UPI QR client-side, because the read is authenticated and per-customer.
 */
export const dynamic = 'force-dynamic';

interface OrderPageProps {
  readonly params: Promise<{ readonly id: string }>;
}

export default async function OrderPage({ params }: OrderPageProps) {
  const { id } = await params;
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 lg:px-6">
      <OrderConfirmation orderId={id} />
    </main>
  );
}
