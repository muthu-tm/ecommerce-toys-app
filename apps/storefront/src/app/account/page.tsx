import { AccountDashboard } from '@/components/account/AccountDashboard';

/** The account home — a client dashboard behind the auth context. */
export const metadata = { title: 'Your account' };

export default function AccountPage() {
  return <AccountDashboard />;
}
