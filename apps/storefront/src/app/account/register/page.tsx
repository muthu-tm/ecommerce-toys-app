import { AuthShell } from '@/components/account/AuthShell';
import { RegisterForm } from '@/components/account/RegisterForm';

/** The registration page — a thin server shell over the client form. */
export const metadata = { title: 'Create an account' };

export default function RegisterPage() {
  return (
    <AuthShell>
      <RegisterForm />
    </AuthShell>
  );
}
