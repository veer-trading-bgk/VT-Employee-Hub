import { AppShell } from '@/components/layout/AppShell';

export default function ManagerLayout({ children }: { children: React.ReactNode }) {
  return <AppShell allowedRoles={['admin', 'manager']}>{children}</AppShell>;
}
