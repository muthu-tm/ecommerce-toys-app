import { AccountOrderDetail } from '@/components/account/AccountOrderDetail';

export const metadata = { title: 'Order' };

export default async function AccountOrderPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AccountOrderDetail orderId={id} />;
}
