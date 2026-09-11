import { Card } from '@romp/ui';

import { RegisterForm } from '@/components/account/RegisterForm';

/** The registration page — a thin server shell over the client form. */
export const metadata = { title: 'Create an account' };

export default function RegisterPage() {
  return (
    <div className="mx-auto max-w-md">
      <Card className="p-6">
        <RegisterForm />
      </Card>
    </div>
  );
}
