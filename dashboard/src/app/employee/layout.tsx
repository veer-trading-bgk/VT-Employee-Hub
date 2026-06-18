import { AppShell } from '@/components/layout/AppShell';

export default function EmployeeLayout({ children }: { children: React.ReactNode }) {
  return <AppShell allowedRoles={['telecaller', 'agent', 'intern']}>{children}</AppShell>;
}
