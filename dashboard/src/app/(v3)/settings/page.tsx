'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  User,
  Building2,
  Users,
  Smartphone,
  Bell,
  Lock,
  CreditCard,
  Globe,
  Tag,
  LayoutGrid,
  Zap,
  Activity,
  ChevronRight,
  Sun,
  Moon,
  LogOut,
} from 'lucide-react';
import { Card } from '@/components/v3/ui/Card';
import { Badge } from '@/components/v3/ui/Badge';
import { Toggle } from '@/components/v3/ui/Toggle';
import { Button } from '@/components/v3/ui/Button';
import { Avatar } from '@/components/v3/ui/Avatar';
import { Input, Textarea } from '@/components/v3/ui/Input';
import { cn } from '@/lib/cn';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { toV3Role, V3_ROLE_LABELS } from '@/types/v3';
import { toast } from 'sonner';

// ── Section definitions ───────────────────────────────────────────────────────

type SettingsSection =
  | 'profile'
  | 'organisation'
  | 'employees'
  | 'whatsapp'
  | 'notifications'
  | 'security'
  | 'billing'
  | 'integrations'
  | 'tags'
  | 'pipeline'
  | 'workflows'
  | 'audit'
  | 'appearance';

interface SectionDef {
  id: SettingsSection;
  label: string;
  description: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

const SECTIONS: SectionDef[] = [
  { id: 'profile',       label: 'Profile',         description: 'Your personal info and photo',           icon: <User className="h-5 w-5" /> },
  { id: 'appearance',    label: 'Appearance',       description: 'Theme, font size, display',              icon: <Sun className="h-5 w-5" /> },
  { id: 'notifications', label: 'Notifications',    description: 'What to be notified about',              icon: <Bell className="h-5 w-5" /> },
  { id: 'security',      label: 'Security',         description: 'Password and two-factor auth',           icon: <Lock className="h-5 w-5" /> },
  { id: 'organisation',  label: 'Organisation',     description: 'Company name, logo, settings',           icon: <Building2 className="h-5 w-5" />, adminOnly: true },
  { id: 'employees',     label: 'Employees',        description: 'Invite, manage roles and permissions',   icon: <Users className="h-5 w-5" />, adminOnly: true },
  { id: 'whatsapp',      label: 'WhatsApp',         description: 'Connect and manage WhatsApp Business',   icon: <Smartphone className="h-5 w-5" />, adminOnly: true },
  { id: 'pipeline',      label: 'Pipeline Stages',  description: 'Customise your sales stages',            icon: <LayoutGrid className="h-5 w-5" />, adminOnly: true },
  { id: 'tags',          label: 'Tags',             description: 'Manage contact tags',                    icon: <Tag className="h-5 w-5" />, adminOnly: true },
  { id: 'workflows',     label: 'Workflow settings',description: 'Manage and configure automations',       icon: <Zap className="h-5 w-5" />, adminOnly: true },
  { id: 'integrations',  label: 'Integrations',     description: 'Connect third-party tools',              icon: <Globe className="h-5 w-5" />, adminOnly: true },
  { id: 'billing',       label: 'Billing & Plan',   description: 'Subscription, invoices, usage',          icon: <CreditCard className="h-5 w-5" />, adminOnly: true },
  { id: 'audit',         label: 'Audit Log',        description: 'Track all admin actions',                icon: <Activity className="h-5 w-5" />, adminOnly: true },
];

// ── Profile section ───────────────────────────────────────────────────────────

function ProfileSection() {
  const { user } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    // API call would go here
    await new Promise((r) => setTimeout(r, 600));
    toast.success('Profile updated');
    setSaving(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Profile</h2>
        <p className="text-sm text-neutral-500">Your personal information</p>
      </div>
      <form onSubmit={handleSave} className="space-y-4">
        <div className="flex items-center gap-4">
          <Avatar name={user?.name ?? '?'} size={64} />
          <div>
            <Button variant="secondary" size="sm" type="button">
              Change photo
            </Button>
            <p className="mt-1 text-xs text-neutral-400">JPG, PNG up to 2MB</p>
          </div>
        </div>
        <Input
          label="Full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Input
          label="Email"
          type="email"
          value={user?.email ?? ''}
          disabled
          hint="Contact your admin to change your email"
        />
        <Button type="submit" loading={saving}>Save changes</Button>
      </form>
    </div>
  );
}

// ── Appearance section ────────────────────────────────────────────────────────

function AppearanceSection() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Appearance</h2>
        <p className="text-sm text-neutral-500">Personalise how APForce looks</p>
      </div>
      <Card>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {theme === 'dark' ? (
              <Moon className="h-5 w-5 text-neutral-500" aria-hidden />
            ) : (
              <Sun className="h-5 w-5 text-neutral-500" aria-hidden />
            )}
            <div>
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {theme === 'dark' ? 'Dark mode' : 'Light mode'}
              </p>
              <p className="text-xs text-neutral-500">
                Toggle between light and dark interface
              </p>
            </div>
          </div>
          <Toggle
            checked={theme === 'dark'}
            onChange={toggleTheme}
            aria-label="Toggle dark mode"
          />
        </div>
      </Card>
    </div>
  );
}

// ── Employees section ─────────────────────────────────────────────────────────

function EmployeesSection() {
  interface Employee {
    id: string;
    name: string;
    email: string;
    role: string;
    status: 'active' | 'invited' | 'deactivated';
    lastActiveAt?: string;
  }

  const [employees] = useState<Employee[]>([]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            Employees
          </h2>
          <p className="text-sm text-neutral-500">Manage team members and their access</p>
        </div>
        <Button size="sm" iconLeft={<Users className="h-4 w-4" />}>
          Invite employee
        </Button>
      </div>

      {employees.length === 0 ? (
        <Card variant="ghost" className="py-10 text-center">
          <Users className="mx-auto h-8 w-8 text-neutral-300 mb-3" aria-hidden />
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">No employees yet</p>
          <p className="text-xs text-neutral-500 mt-1">Invite your team to get started</p>
          <Button size="sm" className="mt-4">Invite first employee</Button>
        </Card>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900" role="list">
          {employees.map((emp) => (
            <li key={emp.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={emp.name} size={32} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{emp.name}</p>
                <p className="text-xs text-neutral-500">{emp.email}</p>
              </div>
              <Badge variant={emp.status === 'active' ? 'success' : emp.status === 'invited' ? 'warning' : 'default'}>
                {emp.status}
              </Badge>
              <Badge variant="default">{emp.role}</Badge>
              <Button variant="ghost" size="sm">Edit</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── WhatsApp section ──────────────────────────────────────────────────────────

function WhatsAppSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">WhatsApp</h2>
        <p className="text-sm text-neutral-500">Manage your WhatsApp Business connection</p>
      </div>
      <Card>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success-50 dark:bg-success-900/20">
              <Smartphone className="h-5 w-5 text-success-600" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                WhatsApp Business API
              </p>
              <p className="text-xs text-neutral-500">Connected via Meta Cloud API</p>
            </div>
          </div>
          <Badge variant="success" dot>Connected</Badge>
        </div>
        <div className="mt-4 grid gap-3 text-sm">
          <div className="flex justify-between">
            <span className="text-neutral-500">Phone number</span>
            <span className="font-medium text-neutral-900 dark:text-neutral-100">+91 98765 43210</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Display name</span>
            <span className="font-medium text-neutral-900 dark:text-neutral-100">APForce</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Quality rating</span>
            <Badge variant="success">High</Badge>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="sm">Manage templates</Button>
          <Button variant="ghost" size="sm">Reconnect</Button>
        </div>
      </Card>
    </div>
  );
}

// ── Stub sections ─────────────────────────────────────────────────────────────

function StubSection({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
        <p className="text-sm text-neutral-500">{description}</p>
      </div>
      <Card variant="ghost" className="py-10 text-center text-sm text-neutral-400">
        {title} settings — coming soon
      </Card>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const v3Role = toV3Role((user?.role ?? 'telecaller') as Parameters<typeof toV3Role>[0]);
  const isAdmin = ['owner', 'admin'].includes(v3Role);

  const [activeSection, setActiveSection] = useState<SettingsSection>('profile');

  const visibleSections = SECTIONS.filter((s) => !s.adminOnly || isAdmin);

  function renderContent() {
    switch (activeSection) {
      case 'profile':       return <ProfileSection />;
      case 'appearance':    return <AppearanceSection />;
      case 'employees':     return <EmployeesSection />;
      case 'whatsapp':      return <WhatsAppSection />;
      case 'notifications': return <StubSection title="Notifications" description="Manage your notification preferences" />;
      case 'security':      return <StubSection title="Security" description="Password, 2FA, and session management" />;
      case 'organisation':  return <StubSection title="Organisation" description="Company name, logo, and timezone" />;
      case 'pipeline':      return <StubSection title="Pipeline Stages" description="Customise your sales pipeline stages" />;
      case 'tags':          return <StubSection title="Tags" description="Create and manage contact tags" />;
      case 'workflows':     return <StubSection title="Workflow settings" description="Default workflow behaviour" />;
      case 'integrations':  return <StubSection title="Integrations" description="Connect to third-party tools" />;
      case 'billing':       return <StubSection title="Billing & Plan" description="Subscription and payment details" />;
      case 'audit':         return <StubSection title="Audit Log" description="Admin action history" />;
      default:              return null;
    }
  }

  return (
    <div className="flex h-full">
      {/* Settings nav */}
      <aside className="hidden w-[240px] shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 md:flex">
        <div className="border-b border-neutral-200 px-4 py-4 dark:border-neutral-800">
          <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Settings</h1>
        </div>
        <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 py-3" aria-label="Settings sections">
          {visibleSections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              aria-current={activeSection === section.id ? 'page' : undefined}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                activeSection === section.id
                  ? 'bg-primary-50 font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                  : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800',
              )}
            >
              <span className="shrink-0 text-current opacity-70">{section.icon}</span>
              {section.label}
            </button>
          ))}
        </nav>
        {/* Logout */}
        <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
          <button
            onClick={logout}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-error-600 hover:bg-error-50 transition-colors dark:hover:bg-error-900/20"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Logout
          </button>
        </div>
      </aside>

      {/* Settings content */}
      <main className="scrollbar-thin flex-1 overflow-y-auto p-6">
        {renderContent()}
      </main>
    </div>
  );
}
