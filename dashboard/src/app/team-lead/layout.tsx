import { AppShell } from '@/components/layout/AppShell';

export default function TeamLeadLayout({ children }: { children: React.ReactNode }) {
  return <AppShell allowedRoles={['team_lead']}>{children}</AppShell>;
}
