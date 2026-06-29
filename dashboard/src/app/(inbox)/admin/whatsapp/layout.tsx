import { AppShell } from '@/components/layout/AppShell';
import type { Role } from '@/types';

const ALLOWED: Role[] = ['admin', 'superadmin', 'manager', 'team_lead', 'telecaller', 'agent', 'intern'];

export default function WhatsAppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell allowedRoles={ALLOWED}>{children}</AppShell>;
}
