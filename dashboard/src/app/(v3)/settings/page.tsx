'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
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
  Sun,
  Moon,
  LogOut,
  Search,
  RefreshCw,
  Copy,
  Eye,
  EyeOff,
  Edit2,
  Save,
  X,
  Sparkles,
  FileText,
  KeyRound,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/v3/ui/Card';
import { Badge } from '@/components/v3/ui/Badge';
import { Toggle } from '@/components/v3/ui/Toggle';
import { Button } from '@/components/v3/ui/Button';
import { Avatar } from '@/components/v3/ui/Avatar';
import { Input } from '@/components/v3/ui/Input';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { cn } from '@/lib/cn';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { apiFetch, api, apiErrorMessage } from '@/lib/api';
import { uploadFileToS3 } from '@/lib/mediaUpload';
import { useAvatarUrl } from '@/hooks/useAvatarUrl';
import { useMetricsConfig } from '@/hooks/useMetricsConfig';
import type { Role } from '@/types';
import { toast } from 'sonner';
import { EmployeesSection } from '@/components/v3/team/EmployeesSection';
import { AISection } from '@/components/v3/settings/AISection';
import { WabaHealthPanel } from '@/components/settings/WabaHealthPanel';
import { WhatsAppFlowsPanel } from '@/components/settings/WhatsAppFlowsPanel';
import { BranchesPanel } from '@/components/settings/BranchesPanel';
import { SettingsTemplatesSection } from '@/components/settings/SettingsTemplatesSection';

// ── Section definitions ───────────────────────────────────────────────────────

type SettingsSection =
  | 'profile'
  | 'organisation'
  | 'employees'
  | 'whatsapp'
  | 'ai'
  | 'notifications'
  | 'security'
  | 'billing'
  | 'integrations'
  | 'tags'
  | 'pipeline'
  | 'workflows'
  | 'audit'
  | 'targets'
  | 'metric-config'
  | 'appearance'
  | 'templates'
  | 'api-keys';

interface SectionDef {
  id: SettingsSection;
  label: string;
  description: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  // Raw backend roles (not v3Role — DL-021, docs/v3/12_DECISION_LOG.md)
  // allowed to see this section, for tiers the binary adminOnly flag can't
  // express (e.g. Templates: visible to admin+manager, hidden for sales/
  // support). Only the Templates entry uses this today; every other section
  // keeps using adminOnly. superadmin always sees every section regardless
  // (see visibleSections below), matching checkRole()/ProtectedRoute's own
  // unconditional superadmin bypass elsewhere in this codebase.
  visibleToRoles?: Role[];
}

const SECTIONS: SectionDef[] = [
  { id: 'profile',       label: 'Profile',         description: 'Your personal info and photo',           icon: <User className="h-5 w-5" /> },
  { id: 'appearance',    label: 'Appearance',       description: 'Theme, font size, display',              icon: <Sun className="h-5 w-5" /> },
  { id: 'notifications', label: 'Notifications',    description: 'What to be notified about',              icon: <Bell className="h-5 w-5" /> },
  { id: 'security',      label: 'Security',         description: 'Password and two-factor auth',           icon: <Lock className="h-5 w-5" /> },
  { id: 'organisation',  label: 'Organisation',     description: 'Company name, logo, settings',           icon: <Building2 className="h-5 w-5" />, adminOnly: true },
  { id: 'employees',     label: 'Employees',        description: 'Invite, manage roles and permissions',   icon: <Users className="h-5 w-5" />, adminOnly: true },
  { id: 'whatsapp',      label: 'WhatsApp',         description: 'Connect and manage WhatsApp Business',   icon: <Smartphone className="h-5 w-5" />, adminOnly: true },
  { id: 'templates',     label: 'Templates',        description: 'Meta-approved WhatsApp message templates', icon: <FileText className="h-5 w-5" />, visibleToRoles: ['admin', 'manager'] },
  { id: 'ai',            label: 'AI',               description: 'Master switch and per-feature AI controls', icon: <Sparkles className="h-5 w-5" />, adminOnly: true },
  { id: 'pipeline',      label: 'Pipeline Stages',  description: 'Customise your sales stages',            icon: <LayoutGrid className="h-5 w-5" />, adminOnly: true },
  { id: 'tags',          label: 'Tags',             description: 'Manage contact tags',                    icon: <Tag className="h-5 w-5" />, visibleToRoles: ['admin', 'manager'] },
  { id: 'workflows',     label: 'Workflow settings',description: 'Manage and configure automations',       icon: <Zap className="h-5 w-5" />, adminOnly: true },
  { id: 'integrations',  label: 'Integrations',     description: 'Connect third-party tools',              icon: <Globe className="h-5 w-5" />, adminOnly: true },
  { id: 'api-keys',      label: 'API Keys',         description: 'Keys for the public form-submission API', icon: <KeyRound className="h-5 w-5" />, adminOnly: true },
  { id: 'billing',       label: 'Billing & Plan',   description: 'Subscription, invoices, usage',          icon: <CreditCard className="h-5 w-5" />, adminOnly: true },
  { id: 'targets',       label: 'Metric Targets',   description: 'Set daily or monthly targets',           icon: <Activity className="h-5 w-5" />, adminOnly: true },
  { id: 'metric-config', label: 'Metric Config',    description: 'Edit metric labels, icons and weights',  icon: <Zap className="h-5 w-5" />, adminOnly: true },
  { id: 'audit',         label: 'Audit Log',        description: 'Track all admin actions',                icon: <Activity className="h-5 w-5" />, adminOnly: true },
];

// Single predicate shared by the sidebar filter and renderContent()'s own
// gate (B3 audit finding #5) — before this, renderContent() didn't consult
// visibility at all, so a role could reach any section's real component
// (and its real API calls) just by navigating straight to its ?tab= value,
// bypassing the sidebar that would otherwise never render that button for
// them. `isAdmin` is threaded in rather than recomputed here since it's
// itself derived from v3Role (a separate, already-tracked, harmless-per-
// B3-finding-#10 style issue — not this fix's concern).
function isSectionVisible(section: SectionDef, rawRole: Role | undefined, isAdmin: boolean): boolean {
  if (section.visibleToRoles) return rawRole === 'superadmin' || (!!rawRole && section.visibleToRoles.includes(rawRole));
  return !section.adminOnly || isAdmin;
}

// ── Profile section ───────────────────────────────────────────────────────────

// B3 finding #11: name/photo only, matching what was already exposed here —
// backend's PUT /api/auth/me also accepts mobileNumber/homeAddress (see
// selfProfileUpdateSchema), but adding input fields for those is a separate
// UI-scope decision this fix doesn't make on its own.
const AVATAR_ALLOWED_MIME = new Set(['image/jpeg', 'image/png']);
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

function ProfileSection() {
  const { user, refreshUser } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarUrl = useAvatarUrl(user?.avatarKey);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateProfile({ name });
      await refreshUser();
      toast.success('Profile updated');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to update profile'));
    } finally {
      setSaving(false);
    }
  }

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file (e.g. after a rejected one)
    if (!file) return;
    if (!AVATAR_ALLOWED_MIME.has(file.type)) {
      toast.error('Only JPG and PNG images are allowed');
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error('Photo must be under 2MB');
      return;
    }
    setUploadingPhoto(true);
    try {
      const { s3Key } = await uploadFileToS3(file, undefined, '/api/auth/me/avatar-upload-url');
      await api.updateProfile({ avatarKey: s3Key });
      await refreshUser();
      toast.success('Photo updated');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to upload photo'));
    } finally {
      setUploadingPhoto(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Profile</h2>
        <p className="text-sm text-neutral-500">Your personal information</p>
      </div>
      <form onSubmit={handleSave} className="space-y-4">
        <div className="flex items-center gap-4">
          <Avatar src={avatarUrl} name={user?.name ?? '?'} size={64} />
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              onChange={handlePhotoSelect}
            />
            <Button variant="secondary" size="sm" type="button" loading={uploadingPhoto} onClick={() => fileInputRef.current?.click()}>
              Change photo
            </Button>
            <p className="mt-1 text-xs text-neutral-400">JPG, PNG up to 2MB</p>
          </div>
        </div>
        <Input label="Full name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label="Email" type="email" value={user?.email ?? ''} disabled hint="Contact your admin to change your email" />
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
              <p className="text-xs text-neutral-500">Toggle between light and dark interface</p>
            </div>
          </div>
          <Toggle checked={theme === 'dark'} onChange={toggleTheme} aria-label="Toggle dark mode" />
        </div>
      </Card>
    </div>
  );
}

// ── Employees section ─────────────────────────────────────────────────────────

// ── WhatsApp section ──────────────────────────────────────────────────────────

interface FullWabaConfig {
  connected: boolean;
  accessTokenSet: boolean;
  accessTokenPreview: string | null;
  phoneNumberId: string | null;
  wabaId: string | null;
  phoneNumber: string | null;
  businessManagerId: string | null;
  graphApiVersion: string;
  webhookVerifyTokenSet: boolean;
  webhookCallbackUrl: string;
  connectedAt: string | null;
  setupMethod: string | null;
  configValid: boolean;
  configIssue: string | null;
}

interface WabaForm {
  accessToken: string;
  phoneNumberId: string;
  wabaId: string;
  businessManagerId: string;
  graphApiVersion: string;
  webhookVerifyToken: string;
}

type WabaFormErrors = Partial<Record<keyof WabaForm, string>>;

const EMPTY_WABA_FORM: WabaForm = {
  accessToken: '',
  phoneNumberId: '',
  wabaId: '',
  businessManagerId: '',
  graphApiVersion: 'v25.0',
  webhookVerifyToken: '',
};

interface WabaTestResult {
  ok: boolean;
  autoDiscovered: boolean;
  discoveredWabaId: string | null;
  phoneNumber: string | null;
  verifiedName: string | null;
  reason: string | null;
  rawError?: unknown;
}

// ── View-mode read-only row with optional copy button ─────────────────────────
function ViewRow({ label, value, mono = false, onCopy, helpText }: {
  label: string; value: string | null | undefined; mono?: boolean;
  onCopy?: () => void; helpText?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-[148px] shrink-0">
        <p className="text-xs text-neutral-500">{label}</p>
        {helpText && <p className="mt-0.5 text-[10px] text-neutral-400">{helpText}</p>}
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={cn(
          'min-w-0 max-w-[260px] truncate text-right text-xs text-neutral-800 dark:text-neutral-200',
          mono && 'font-mono text-[11px]',
        )}>
          {value || '—'}
        </span>
        {onCopy && value && value !== '—' && (
          <button
            type="button"
            onClick={onCopy}
            title="Copy"
            className="shrink-0 text-neutral-300 transition-colors hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            <Copy className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Form field wrapper with label, error, and help text ───────────────────────
function FieldRow({ label, required = false, helpText, error, children }: {
  label: string; required?: boolean; helpText?: string; error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1 text-xs font-medium text-neutral-700 dark:text-neutral-300">
        {label}
        {required
          ? <span className="ml-0.5 text-error-500">*</span>
          : <span className="ml-1 font-normal text-neutral-400">(optional)</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-error-600 dark:text-error-400">{error}</p>
      ) : helpText ? (
        <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">{helpText}</p>
      ) : null}
    </div>
  );
}

// ── Enterprise WhatsApp connection wizard ─────────────────────────────────────
function WhatsAppSection() {
  const qc = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<WabaForm>(EMPTY_WABA_FORM);
  const [errors, setErrors] = useState<WabaFormErrors>({});
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<WabaTestResult | null>(null);
  const [showTestRaw, setShowTestRaw] = useState(false);

  const { data: cfg, isLoading, isError, refetch } = useQuery<FullWabaConfig>({
    queryKey: ['whatsapp-config-full'],
    queryFn: () => apiFetch<FullWabaConfig>('/api/whatsapp/config/full'),
    staleTime: 30_000,
  });

  const connected = cfg?.connected ?? false;
  const mode = editMode ? 'edit' : connected ? 'view' : 'connect';
  const isFormMode = mode === 'edit' || mode === 'connect';

  function startEdit() {
    setForm({
      accessToken: '',
      phoneNumberId: cfg?.phoneNumberId ?? '',
      wabaId: cfg?.wabaId ?? '',
      businessManagerId: cfg?.businessManagerId ?? '',
      graphApiVersion: cfg?.graphApiVersion ?? 'v25.0',
      webhookVerifyToken: '',
    });
    setErrors({});
    setTestResult(null);
    setShowToken(false);
    setEditMode(true);
  }

  function cancelEdit() {
    setForm(EMPTY_WABA_FORM);
    setErrors({});
    setTestResult(null);
    setShowToken(false);
    setEditMode(false);
  }

  function setField(key: keyof WabaForm, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
    if (testResult) { setTestResult(null); setShowTestRaw(false); }
  }

  function validate(isUpdate: boolean): WabaFormErrors {
    const f = form;
    const err: WabaFormErrors = {};
    if (!isUpdate && !f.accessToken.trim()) err.accessToken = 'Access token is required';
    if (!f.phoneNumberId.trim()) err.phoneNumberId = 'Phone Number ID is required';
    if (!f.wabaId.trim()) err.wabaId = 'WABA ID is required';
    if (f.phoneNumberId.trim() && f.wabaId.trim() && f.phoneNumberId.trim() === f.wabaId.trim()) {
      err.wabaId = 'WABA ID cannot equal Phone Number ID — these are different Meta identifiers';
    }
    if (f.graphApiVersion.trim() && !/^v\d+\.\d+$/.test(f.graphApiVersion.trim())) {
      err.graphApiVersion = 'Must be in format vNN.N (e.g. v25.0)';
    }
    return err;
  }

  async function handleTest() {
    const token = form.accessToken.trim();
    const phoneId = form.phoneNumberId.trim();
    const errs: WabaFormErrors = {};
    if (!token) errs.accessToken = 'Enter access token to test';
    if (!phoneId) errs.phoneNumberId = 'Phone Number ID is required';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setTesting(true);
    setTestResult(null);
    setShowTestRaw(false);
    try {
      const result = await apiFetch<{
        phoneValid: boolean; autoDiscovered: boolean; wabaId: string | null;
        phoneNumber: string | null; verifiedName: string | null; reason: string | null; rawError?: unknown;
      }>('/api/whatsapp/connection/probe', {
        method: 'POST',
        body: JSON.stringify({ accessToken: token, phoneNumberId: phoneId }),
      });
      if (result.autoDiscovered && result.wabaId && !form.wabaId.trim()) {
        setForm((prev) => ({ ...prev, wabaId: result.wabaId! }));
      }
      setTestResult({
        ok: result.phoneValid && (result.autoDiscovered || !!form.wabaId.trim()),
        autoDiscovered: result.autoDiscovered,
        discoveredWabaId: result.wabaId,
        phoneNumber: result.phoneNumber,
        verifiedName: result.verifiedName,
        reason: result.reason ?? null,
        rawError: result.rawError,
      });
    } catch (e: unknown) {
      setTestResult({
        ok: false, autoDiscovered: false, discoveredWabaId: null,
        phoneNumber: null, verifiedName: null,
        reason: e instanceof Error ? e.message : 'Connection test failed',
      });
    } finally {
      setTesting(false);
    }
  }

  const saveMut = useMutation({
    mutationFn: () => {
      if (!connected) {
        return apiFetch<{ success: boolean; phoneNumber: string }>('/api/whatsapp/manual-connect', {
          method: 'POST',
          body: JSON.stringify({
            accessToken: form.accessToken.trim(),
            phoneNumberId: form.phoneNumberId.trim(),
            wabaId: form.wabaId.trim(),
          }),
        });
      }
      return apiFetch<{ success: boolean }>('/api/whatsapp/config', {
        method: 'PUT',
        body: JSON.stringify({
          ...(form.accessToken.trim() && { accessToken: form.accessToken.trim() }),
          phoneNumberId: form.phoneNumberId.trim(),
          wabaId: form.wabaId.trim(),
          businessManagerId: form.businessManagerId.trim() || null,
          graphApiVersion: form.graphApiVersion.trim() || null,
          ...(form.webhookVerifyToken.trim() && { webhookVerifyToken: form.webhookVerifyToken.trim() }),
        }),
      });
    },
    onSuccess: () => {
      toast.success(connected ? 'Configuration saved' : 'WhatsApp connected successfully');
      setEditMode(false);
      setForm(EMPTY_WABA_FORM);
      setTestResult(null);
      qc.invalidateQueries({ queryKey: ['whatsapp-config-full'] });
      qc.invalidateQueries({ queryKey: ['whatsapp-connection'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleSave() {
    const errs = validate(connected);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    saveMut.mutate();
  }

  const disconnectMut = useMutation({
    mutationFn: () => apiFetch('/api/whatsapp/connection', { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('WhatsApp disconnected');
      setEditMode(false);
      qc.invalidateQueries({ queryKey: ['whatsapp-config-full'] });
      qc.invalidateQueries({ queryKey: ['whatsapp-connection'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function handleOAuth() {
    try {
      const res = await apiFetch<{ url: string }>('/api/whatsapp/auth/init');
      const popup = window.open(res.url, 'wa_connect', 'width=600,height=700');
      const onMsg = (e: MessageEvent) => {
        if (e.data?.type === 'waba_connected') {
          toast.success(e.data.message ?? 'WhatsApp connected');
          qc.invalidateQueries({ queryKey: ['whatsapp-config-full'] });
          qc.invalidateQueries({ queryKey: ['whatsapp-connection'] });
          window.removeEventListener('message', onMsg);
        } else if (e.data?.type === 'waba_failed') {
          toast.error(e.data.message ?? 'Connection failed');
          window.removeEventListener('message', onMsg);
        }
      };
      window.addEventListener('message', onMsg);
      const t = setInterval(() => {
        if (popup?.closed) { clearInterval(t); window.removeEventListener('message', onMsg); }
      }, 500);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'OAuth failed';
      if (msg.includes('META_APP_ID')) toast.error('Meta App ID not configured on server — use manual setup below');
      else toast.error(msg);
    }
  }

  function copy(val: string | null | undefined, label: string) {
    if (!val) return;
    navigator.clipboard.writeText(val).then(() => toast.success(`${label} copied`)).catch(() => toast.error('Copy failed'));
  }

  const inputCls = (hasErr?: string) => cn(
    'w-full rounded-lg border px-3 py-2 text-sm placeholder:text-neutral-400 focus:outline-none transition-colors',
    'bg-white dark:bg-neutral-800 dark:text-neutral-100',
    hasErr
      ? 'border-error-400 focus:border-error-500 dark:border-error-600'
      : 'border-neutral-200 focus:border-primary-600 dark:border-neutral-700 dark:focus:border-primary-500',
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }

  // Never fall back to `connected = cfg?.connected ?? false` -> the full
  // "Connect WhatsApp" onboarding form on a failed fetch (B3 audit finding
  // #5/#6) — that misrepresents a real, already-connected WABA as
  // unconfigured to whoever hit this failure (e.g. a transient error, or a
  // non-admin who reached this component some other way), and exposes the
  // manual-connect access-token fields for no reason.
  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">WhatsApp Business</h2>
          <p className="text-sm text-neutral-500">Connect and configure your Meta WhatsApp Business API</p>
        </div>
        <Card><ErrorRetry message="Failed to load WhatsApp configuration" onRetry={refetch} /></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── Page header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">WhatsApp Business</h2>
          <p className="text-sm text-neutral-500">Connect and configure your Meta WhatsApp Business API</p>
        </div>
        <Badge variant={connected ? 'success' : 'default'} dot={connected}>
          {connected ? 'Connected' : 'Not Connected'}
        </Badge>
      </div>

      {/* ── Configuration card ──────────────────────────────────── */}
      <Card>

        {/* Card header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={cn(
              'flex h-10 w-10 items-center justify-center rounded-xl',
              connected ? 'bg-success-50 dark:bg-success-900/20' : 'bg-neutral-100 dark:bg-neutral-800',
            )}>
              <Smartphone className={cn('h-5 w-5', connected ? 'text-success-600' : 'text-neutral-400')} />
            </div>
            <div>
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {mode === 'edit' ? 'Edit Configuration' : connected ? 'WhatsApp Business API' : 'Connect WhatsApp'}
              </p>
              <p className="text-xs text-neutral-500">
                {mode === 'edit'
                  ? 'Update credentials and settings below — save when done'
                  : connected
                  ? `Meta Cloud API · ${cfg?.setupMethod === 'manual' ? 'Manual setup' : 'OAuth'}`
                  : 'Enter your Meta WhatsApp Business credentials to get started'}
              </p>
            </div>
          </div>
          {mode === 'view' && (
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="secondary" size="sm" onClick={startEdit}>
                <Edit2 className="h-3.5 w-3.5" />
                Edit
              </Button>
              <Button
                variant="danger" size="sm"
                loading={disconnectMut.isPending}
                onClick={() => {
                  if (confirm('Disconnect WhatsApp? All messaging will stop immediately.')) disconnectMut.mutate();
                }}
              >
                Disconnect
              </Button>
            </div>
          )}
        </div>

        {/* ── VIEW MODE: Read-only config table ─────────────────── */}
        {mode === 'view' && cfg && (
          <div className="mt-4 divide-y divide-neutral-100 dark:divide-neutral-800">
            <ViewRow
              label="Access Token"
              value={cfg.accessTokenSet ? (cfg.accessTokenPreview ?? '••••••') : 'Not set'}
              mono
              helpText="Stored securely — last 6 chars shown"
            />
            <ViewRow
              label="Phone Number ID"
              value={cfg.phoneNumberId}
              mono
              onCopy={() => copy(cfg.phoneNumberId, 'Phone Number ID')}
            />
            <ViewRow
              label="WABA ID"
              value={cfg.wabaId}
              mono
              onCopy={() => copy(cfg.wabaId, 'WABA ID')}
            />
            <ViewRow
              label="Business Manager ID"
              value={cfg.businessManagerId}
              mono={!!cfg.businessManagerId}
              onCopy={cfg.businessManagerId ? () => copy(cfg.businessManagerId, 'Business Manager ID') : undefined}
            />
            <ViewRow label="Phone Number" value={cfg.phoneNumber} />
            <ViewRow label="Graph API Version" value={cfg.graphApiVersion ?? 'v25.0'} />
            <ViewRow
              label="Webhook Verify Token"
              value={cfg.webhookVerifyTokenSet ? '••••• (set)' : 'Not set'}
            />
            <ViewRow
              label="Webhook Callback URL"
              value={cfg.webhookCallbackUrl}
              mono
              onCopy={() => copy(cfg.webhookCallbackUrl, 'Webhook URL')}
            />
            <ViewRow
              label="Connected"
              value={cfg.connectedAt
                ? new Date(cfg.connectedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                : undefined}
            />
            <ViewRow
              label="Setup Method"
              value={cfg.setupMethod === 'manual' ? 'Manual' : cfg.setupMethod === 'oauth' ? 'OAuth' : (cfg.setupMethod ?? '—')}
            />
          </div>
        )}

        {/* Config issue alert */}
        {mode === 'view' && cfg?.configIssue && (
          <div className="mt-4 rounded-lg border border-error-200 bg-error-50 px-3 py-2.5 text-xs text-error-700 dark:border-error-800 dark:bg-error-900/20 dark:text-error-300">
            ⚠ Configuration issue: {cfg.configIssue}
          </div>
        )}

        {/* ── CONNECT MODE: OAuth button ─────────────────────────── */}
        {mode === 'connect' && (
          <div className="mt-4 space-y-3">
            <Button onClick={handleOAuth} className="w-full">
              Connect with Meta (OAuth)
            </Button>
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
              <span className="text-xs text-neutral-400">or configure manually below</span>
              <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
            </div>
          </div>
        )}

        {/* ── FORM fields (edit + connect modes) ──────────────────── */}
        {isFormMode && (
          <div className={cn('space-y-4', mode !== 'connect' && 'mt-4')}>

            {/* Access Token */}
            <FieldRow
              label="Access Token"
              required={!connected}
              helpText={connected
                ? 'Leave blank to keep the current stored token unchanged'
                : 'From Meta Business Suite → System Users → Generate Token (enable whatsapp_business_messaging + whatsapp_business_management)'}
              error={errors.accessToken}
            >
              <div className="relative">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={form.accessToken}
                  onChange={(e) => setField('accessToken', e.target.value)}
                  placeholder={connected ? 'Leave blank to keep existing token' : 'EAAxxxxxx...'}
                  autoComplete="off"
                  className={cn(inputCls(errors.accessToken), 'pr-10')}
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  title={showToken ? 'Hide token' : 'Show token'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 transition-colors hover:text-neutral-700 dark:hover:text-neutral-200"
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </FieldRow>

            {/* Phone Number ID */}
            <FieldRow
              label="Phone Number ID"
              required
              helpText="From Meta Business Suite → WhatsApp → API Setup → Phone Number ID (15–16 digit numeric ID)"
              error={errors.phoneNumberId}
            >
              <input
                type="text"
                value={form.phoneNumberId}
                onChange={(e) => setField('phoneNumberId', e.target.value)}
                placeholder="e.g. 1218079021385196"
                className={inputCls(errors.phoneNumberId)}
              />
            </FieldRow>

            {/* WABA ID */}
            <FieldRow
              label="WhatsApp Business Account ID"
              required
              helpText="From Meta Business Suite → WhatsApp Accounts tab (NOT the Phone Number ID from API Setup — these are different identifiers)"
              error={errors.wabaId}
            >
              <input
                type="text"
                value={form.wabaId}
                onChange={(e) => setField('wabaId', e.target.value)}
                placeholder="e.g. 2018738592337131"
                className={inputCls(errors.wabaId)}
              />
              {testResult?.autoDiscovered && testResult.discoveredWabaId && (
                <p className="mt-1 text-[11px] text-success-600 dark:text-success-400">
                  ✓ Auto-detected from Meta and pre-filled above
                </p>
              )}
            </FieldRow>

            {/* Business Manager ID */}
            <FieldRow
              label="Business Manager ID"
              helpText="From Meta Business Suite → Business Settings → Business Info (used for diagnostics and display)"
            >
              <input
                type="text"
                value={form.businessManagerId}
                onChange={(e) => setField('businessManagerId', e.target.value)}
                placeholder="e.g. 123456789012345"
                className={inputCls()}
              />
            </FieldRow>

            {/* Graph API Version */}
            <FieldRow
              label="Graph API Version"
              helpText="Meta Graph API version. Must match WHATSAPP_GRAPH_VERSION Lambda environment variable. Default: v25.0"
              error={errors.graphApiVersion}
            >
              <input
                type="text"
                value={form.graphApiVersion}
                onChange={(e) => setField('graphApiVersion', e.target.value)}
                placeholder="v25.0"
                className={inputCls(errors.graphApiVersion)}
              />
            </FieldRow>

            {/* Webhook Verify Token */}
            <FieldRow
              label="Webhook Verify Token"
              helpText={cfg?.webhookVerifyTokenSet
                ? 'Currently set — leave blank to keep existing, or enter a new token to replace it'
                : 'Secure random string used to verify Meta webhook subscriptions. Also set META_WEBHOOK_VERIFY_TOKEN in Lambda env vars.'}
            >
              <input
                type="text"
                value={form.webhookVerifyToken}
                onChange={(e) => setField('webhookVerifyToken', e.target.value)}
                placeholder={cfg?.webhookVerifyTokenSet ? '(leave blank to keep existing)' : 'Enter a secure random string'}
                className={inputCls()}
              />
            </FieldRow>

            {/* Webhook Callback URL (read-only) */}
            <FieldRow
              label="Webhook Callback URL"
              helpText="Read-only. Set this URL in your Meta App Dashboard → WhatsApp → Configuration → Webhook."
            >
              <div className="flex gap-2">
                <input
                  readOnly
                  value={cfg?.webhookCallbackUrl ?? ''}
                  className={cn(inputCls(), 'flex-1 cursor-default bg-neutral-50 text-neutral-500 dark:bg-neutral-900/50')}
                />
                <Button
                  variant="secondary" size="sm" type="button"
                  onClick={() => copy(cfg?.webhookCallbackUrl, 'Webhook URL')}
                  title="Copy webhook URL"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </FieldRow>
          </div>
        )}

        {/* ── Test Connection result ───────────────────────────── */}
        {testResult && (
          <div className={cn(
            'mt-4 space-y-1 rounded-lg border p-3',
            testResult.ok
              ? 'border-success-200 bg-success-50 dark:border-success-800 dark:bg-success-900/20'
              : 'border-warning-200 bg-warning-50 dark:border-warning-800 dark:bg-warning-900/20',
          )}>
            {testResult.ok ? (
              <>
                <p className="text-xs font-semibold text-success-700 dark:text-success-300">
                  ✓ Connection verified successfully
                </p>
                {(testResult.verifiedName || testResult.phoneNumber) && (
                  <p className="text-xs text-success-600 dark:text-success-400">
                    {[testResult.verifiedName, testResult.phoneNumber].filter(Boolean).join(' · ')}
                  </p>
                )}
                {testResult.autoDiscovered && testResult.discoveredWabaId && (
                  <p className="font-mono text-[10px] text-success-500">
                    WABA ID auto-detected: {testResult.discoveredWabaId}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-xs font-semibold text-warning-800 dark:text-warning-200">
                  {testResult.phoneNumber ? '⚠ Phone verified — WABA ID could not be auto-detected' : '✕ Verification failed'}
                </p>
                {testResult.reason && (
                  <p className="text-xs leading-relaxed text-warning-700 dark:text-warning-300">{testResult.reason}</p>
                )}
                {!!testResult.rawError && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowTestRaw((v) => !v)}
                      className="text-[10px] text-warning-600 underline dark:text-warning-400"
                    >
                      {showTestRaw ? 'Hide' : 'Show'} raw Meta response
                    </button>
                    {showTestRaw && (
                      <pre className="mt-1 max-h-32 overflow-auto rounded bg-warning-100 p-2 font-mono text-[10px] text-warning-800 dark:bg-warning-900/40 dark:text-warning-200">
                        {JSON.stringify(testResult.rawError as object, null, 2)}
                      </pre>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Action bar ──────────────────────────────────────── */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-4 dark:border-neutral-800">
          {isFormMode && (
            <Button
              variant="secondary" size="sm"
              loading={testing}
              disabled={saveMut.isPending}
              onClick={handleTest}
            >
              <Activity className="h-3.5 w-3.5" />
              Test Connection
            </Button>
          )}
          <div className="flex-1" />
          {mode === 'view' && (
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          )}
          {mode === 'edit' && (
            <Button variant="secondary" size="sm" disabled={saveMut.isPending} onClick={cancelEdit}>
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
          )}
          {isFormMode && (
            <Button loading={saveMut.isPending} disabled={testing} onClick={handleSave}>
              <Save className="h-3.5 w-3.5" />
              {connected ? 'Save Configuration' : 'Connect WhatsApp'}
            </Button>
          )}
        </div>
      </Card>

      {/* ── WABA Health Check (connected only) ───────────────────── */}
      {connected && <WabaHealthPanel />}

      {/* ── WhatsApp Flows (connected only) ─────────────────────── */}
      {connected && <WhatsAppFlowsPanel />}

      {/* ── Branches (Item 1c) — shared by the Send Location canvas node and
          the Inbox composer's own "Send Location" button ─────────────── */}
      {connected && <BranchesPanel />}

      {/* Welcome Message config moved to Automation → Workflows (built-in trigger) */}

      {/* ── Credentials guide ─────────────────────────────────────── */}
      <Card variant="ghost" className="space-y-2">
        <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">How to get your credentials</p>
        <ol className="list-inside list-decimal space-y-1.5 text-xs text-neutral-500">
          <li>In Meta Business Suite → <strong>System Users</strong>: create or select a system user</li>
          <li>Add permissions: <strong>whatsapp_business_messaging</strong> and <strong>whatsapp_business_management</strong></li>
          <li>Generate a <strong>permanent access token</strong> (System User → Generate Token → select both permissions)</li>
          <li>Copy your <strong>Phone Number ID</strong> from Meta Business Suite → WhatsApp → API Setup</li>
          <li>Copy your <strong>WABA ID</strong> from Meta Business Suite → WhatsApp <strong>Accounts</strong> tab (a different page from API Setup)</li>
          <li>Click <strong>Test Connection</strong> to verify — WABA ID is auto-detected if permissions allow</li>
        </ol>
      </Card>

    </div>
  );
}

// ── Targets section ───────────────────────────────────────────────────────────

type TargetPeriod = 'day' | 'month';
interface TargetEntry { target: number; targetPeriod: TargetPeriod; pointsWeight?: number; }
interface TargetsResponse { success: boolean; data: Record<string, TargetEntry>; isCustom: boolean; }

function TargetsSection() {
  const qc = useQueryClient();
  const { metrics } = useMetricsConfig();
  const [form, setForm] = useState<Record<string, TargetEntry>>({});
  const [dirty, setDirty] = useState(false);
  // Keys edited since the last time `form` was authoritatively in sync with
  // the server (initial load, or a completed save/reset) — B3 audit finding
  // #12. A ref, not state: it must survive across the background refetch
  // this effect reacts to without itself triggering a re-render/re-run.
  const touchedRef = useRef<Set<string>>(new Set());

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-targets'],
    queryFn: () => apiFetch<TargetsResponse>('/api/admin/targets'),
    staleTime: 5 * 60_000,
  });

  // Race this closes: save metric A -> onSuccess invalidates -> a background
  // refetch (isLoading stays false the whole time, only isFetching flips, so
  // the form never re-covers with a loading state) starts -> user edits
  // metric B while it's in flight -> refetch lands -> this effect used to
  // call setForm(merged) unconditionally, wholesale-replacing the form from
  // the server response and silently discarding B's in-progress keystrokes
  // (plus resetting `dirty` to false, so even the "Unsaved changes" label
  // vanished with no trace). Now: any key touched since the last sync keeps
  // its current local value instead of being overwritten, and `dirty` stays
  // true if anything was actually preserved that way.
  useEffect(() => {
    if (!data?.data) return;
    const merged: Record<string, TargetEntry> = {};
    let anyPreserved = false;
    metrics.forEach((m) => {
      if (touchedRef.current.has(m.key) && form[m.key]) {
        merged[m.key] = form[m.key];
        anyPreserved = true;
        return;
      }
      const stored = data.data[m.key];
      merged[m.key] = {
        target:       stored?.target       ?? m.target,
        targetPeriod: (stored?.targetPeriod ?? m.targetPeriod) as TargetPeriod,
        pointsWeight: stored?.pointsWeight  ?? m.pointsWeight,
      };
    });
    setForm(merged);
    if (!anyPreserved) setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.data]);

  const saveMut = useMutation({
    mutationFn: () => apiFetch('/api/admin/targets', { method: 'PUT', body: JSON.stringify({ targets: form }) }),
    onSuccess: () => {
      toast.success('Targets saved');
      touchedRef.current.clear();
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['admin-targets'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetMut = useMutation({
    mutationFn: () => apiFetch('/api/admin/targets', { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Targets reset to defaults');
      touchedRef.current.clear();
      qc.invalidateQueries({ queryKey: ['admin-targets'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rebuildMut = useMutation({
    mutationFn: () => apiFetch<{ success: boolean; employeesUpdated: number }>('/api/admin/points-rebuild', { method: 'POST' }),
    onSuccess: (res) => toast.success(`Points rebuilt for ${res.employeesUpdated} employees`),
    onError: (e: Error) => toast.error(e.message),
  });

  function updateField(key: string, field: keyof TargetEntry, value: string | number) {
    setForm((prev) => ({ ...prev, [key]: { ...prev[key], [field]: field === 'targetPeriod' ? value : Number(value) } }));
    touchedRef.current.add(key);
    setDirty(true);
  }

  const inputCls = 'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Metric Targets</h2>
          <p className="text-sm text-neutral-500">Set daily or monthly targets for each metric. Changes apply to all employees.</p>
          {data?.isCustom && <span className="mt-1 inline-block rounded-full bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-700 dark:bg-primary-900/40 dark:text-primary-400">Custom targets active</span>}
        </div>
        {data?.isCustom && (
          <Button size="sm" variant="secondary" loading={resetMut.isPending}
            onClick={() => { if (confirm('Reset all targets to system defaults?')) resetMut.mutate(); }}>
            Reset to Defaults
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">{[0,1,2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : isError ? (
        <Card><ErrorRetry message="Failed to load metric targets" onRetry={refetch} /></Card>
      ) : (
        <Card noPadding>
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {metrics.map((m) => {
              const entry = form[m.key];
              if (!entry) return null;
              return (
                <li key={m.key} className="flex flex-wrap items-center gap-4 px-4 py-3">
                  <div className="flex w-44 items-center gap-2 shrink-0">
                    <span className="text-lg">{m.icon}</span>
                    <div>
                      <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{m.label}</p>
                      <p className="text-xs text-neutral-400">{m.unit === 'currency' ? '₹ amount' : 'count'}</p>
                    </div>
                  </div>
                  <div className="flex flex-1 flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-24">
                      <label className="mb-1 block text-xs font-medium text-neutral-500">Target ({entry.targetPeriod === 'day' ? 'per day' : 'per month'})</label>
                      <input type="number" min={0} step={m.unit === 'currency' ? 1000 : 1} value={entry.target} onChange={(e) => updateField(m.key, 'target', e.target.value)} className={inputCls} />
                    </div>
                    <div className="w-32">
                      <label className="mb-1 block text-xs font-medium text-neutral-500">Period</label>
                      <select value={entry.targetPeriod} onChange={(e) => updateField(m.key, 'targetPeriod', e.target.value)} className={inputCls}>
                        <option value="day">Daily</option>
                        <option value="month">Monthly</option>
                      </select>
                    </div>
                    <div className="w-28">
                      <label className="mb-1 block text-xs font-medium text-neutral-500">Points Wt</label>
                      <input type="number" min={1} step={m.unit === 'currency' ? 1000 : 1} value={entry.pointsWeight ?? m.pointsWeight} onChange={(e) => updateField(m.key, 'pointsWeight', e.target.value)} className={inputCls} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button loading={saveMut.isPending} disabled={!dirty} onClick={() => saveMut.mutate()}>Save Targets</Button>
        {dirty && <span className="text-xs text-warning-600">Unsaved changes</span>}
        <div className="ml-auto">
          <Button size="sm" variant="secondary" loading={rebuildMut.isPending}
            onClick={() => { if (confirm('Recalculate ALL employee points from raw metric data?\nThis overwrites the Achievements leaderboard totals.')) rebuildMut.mutate(); }}>
            Rebuild Points
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Audit section ─────────────────────────────────────────────────────────────

const AUDIT_RESULT_BADGE: Record<string, string> = {
  success: 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300',
  flagged: 'bg-error-100 text-error-700 dark:bg-error-900/30 dark:text-error-300',
  approved: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300',
  rejected: 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300',
  failed: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
};

interface AuditLog {
  PK: string; SK: string; userId: string; action: string; target: string;
  result: string; ip: string; timestamp: string;
}

const ACTION_LABELS: Record<string, string> = {
  successful_login: 'Login', failed_login: 'Failed Login',
  metric_added: 'Metric Added', metric_corrected: 'Metric Corrected',
  verify_metric: 'Metric Verified', admin_edit_metric: 'Admin Edit',
  bulk_entry: 'Bulk Entry', create_employee: 'Employee Created',
  employee_updated: 'Employee Updated', employee_permanently_deleted: 'Employee Deleted',
  password_reset: 'Password Reset', setup_2fa: '2FA Setup', reset_2fa: '2FA Reset',
  update_targets: 'Targets Updated', view_analytics: 'Analytics Viewed',
  suspicious_metric_entry: '⚠️ Suspicious Entry',
};

// Shared error-state pattern (B3 audit finding #6) — mirrors TagsSection's
// existing isError block. A fetch failure must never silently render as
// "clean"/"empty"/"nothing configured"; every consumer in this file that
// previously fell through to an empty-looking default on failure now shows
// this instead, gated ahead of that fallback.
function ErrorRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="py-8 text-center">
      <p className="text-sm text-error-600 dark:text-error-400">{message}</p>
      <Button size="sm" variant="secondary" className="mt-2" onClick={onRetry}>Retry</Button>
    </div>
  );
}

function AuditTable({ rows, suspicious }: { rows: AuditLog[]; suspicious?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-100 dark:border-neutral-800">
            {['Time', 'Action', 'User', 'Target', 'Result', 'IP'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase text-neutral-400">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800/60">
          {rows.map((log, i) => (
            <tr key={log.PK + i} className={cn('hover:bg-neutral-50 dark:hover:bg-neutral-800/40', suspicious && 'bg-error-50/30 dark:bg-error-900/10')}>
              <td className="whitespace-nowrap px-4 py-2.5 text-xs text-neutral-400">
                {new Date(log.timestamp).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
              </td>
              <td className={cn('px-4 py-2.5 font-medium', suspicious ? 'text-error-700 dark:text-error-300' : 'text-neutral-800 dark:text-neutral-200')}>
                {ACTION_LABELS[log.action] ?? log.action}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-neutral-500">{log.userId?.slice(0, 12)}…</td>
              <td className="max-w-[180px] truncate px-4 py-2.5 text-xs text-neutral-500" title={log.target}>{log.target}</td>
              <td className="px-4 py-2.5">
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', AUDIT_RESULT_BADGE[log.result] ?? AUDIT_RESULT_BADGE.failed)}>{log.result}</span>
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-neutral-400">{log.ip}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="py-12 text-center text-sm text-neutral-400">No records in this time range</div>}
    </div>
  );
}

function AuditSection() {
  const qc = useQueryClient();
  const [auditTab, setAuditTab] = useState<'logs' | 'suspicious' | 'security'>('logs');
  const [hours, setHours] = useState(24);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');

  const { data: logsData, isLoading: logsLoading, isError: logsError, refetch: refetchLogs } = useQuery({
    queryKey: ['audit-logs', hours],
    queryFn: () => apiFetch<{ success: boolean; data: AuditLog[]; totalRecords: number; timeRange: string }>(`/api/audit/logs?hours=${hours}&limit=500`),
    enabled: auditTab === 'logs',
    staleTime: 60_000,
  });

  const { data: suspData, isLoading: suspLoading, isError: suspError, refetch: refetchSusp } = useQuery({
    queryKey: ['audit-suspicious', hours],
    queryFn: () => apiFetch<{ success: boolean; summary: { failedLogins: number; suspiciousMetrics: number; deletedEmployees: number; totalSuspicious: number }; details: AuditLog[] }>(`/api/audit/suspicious?hours=${hours}`),
    enabled: auditTab === 'suspicious',
    staleTime: 60_000,
  });

  const { data: secData, isLoading: secLoading, isError: secError, refetch: refetchSec } = useQuery({
    queryKey: ['audit-security'],
    queryFn: () => apiFetch<{ success: boolean; statistics: { totalActions: number; successfulLogins: number; failedLogins: number; uniqueUsers: number; uniqueIPs: number; suspiciousActivities: number }; highRiskIPs: { ip: string; failedAttempts: number }[]; recommendations: string[]; generatedAt: string; timeRange: string }>('/api/audit/security-report'),
    enabled: auditTab === 'security',
    staleTime: 5 * 60_000,
  });

  const logs = logsData?.data ?? [];
  const uniqueActions = [...new Set(logs.map((l) => l.action))].sort();
  const filtered = logs.filter((log) => {
    if (actionFilter !== 'all' && log.action !== actionFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return log.userId?.toLowerCase().includes(q) || log.action?.toLowerCase().includes(q) || log.target?.toLowerCase().includes(q) || log.ip?.includes(q);
  });

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Audit Log</h2>
          <p className="text-sm text-neutral-500">Complete trail of all admin and employee actions</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => qc.invalidateQueries({ queryKey: ['audit-logs', hours] })}>Refresh</Button>
          <Button size="sm" variant="secondary" onClick={() => window.open(`/api/audit/export?days=${Math.ceil(hours / 24)}`, '_blank')}>
            Export JSON
          </Button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg border border-neutral-200 bg-white p-1 w-fit dark:border-neutral-700 dark:bg-neutral-900">
        {([['logs', 'All Logs'], ['suspicious', 'Suspicious'], ['security', 'Security']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setAuditTab(id)}
            className={cn('rounded-md px-4 py-1.5 text-xs font-medium transition', auditTab === id ? 'bg-primary-600 text-white' : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800')}>
            {label}
          </button>
        ))}
      </div>

      {/* Time range */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">Time range:</span>
        {([{l:'1h',v:1},{l:'6h',v:6},{l:'24h',v:24},{l:'48h',v:48},{l:'7d',v:168}] as const).map(({l,v}) => (
          <button key={v} onClick={() => setHours(v)}
            className={cn('rounded-full px-3 py-1 text-xs font-semibold transition', hours === v ? 'bg-primary-600 text-white' : 'border border-neutral-200 bg-white text-neutral-600 hover:border-primary-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300')}>
            {l}
          </button>
        ))}
      </div>

      {/* Logs tab */}
      {auditTab === 'logs' && (
        <>
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search user, action, target, IP…"
                className="h-9 w-full rounded-lg border border-neutral-200 bg-white pl-8 pr-3 text-sm focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100" />
            </div>
            <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}
              className="h-9 rounded-lg border border-neutral-200 bg-white px-2 text-sm focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
              <option value="all">All Actions</option>
              {uniqueActions.map((a) => <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>)}
            </select>
          </div>
          {logsLoading ? <Skeleton className="h-48 w-full" /> : logsError ? <ErrorRetry message="Failed to load audit logs" onRetry={refetchLogs} /> : <AuditTable rows={filtered} />}
          {logsData && <p className="text-xs text-neutral-400">Showing {filtered.length} of {logs.length} records · {logsData.timeRange}</p>}
        </>
      )}

      {/* Suspicious tab */}
      {auditTab === 'suspicious' && (
        <>
          {suspLoading ? <Skeleton className="h-48 w-full" /> : suspError ? <ErrorRetry message="Failed to load suspicious-activity data" onRetry={refetchSusp} /> : suspData && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Total Suspicious', value: suspData.summary.totalSuspicious, color: 'text-error-600' },
                  { label: 'Failed Logins',    value: suspData.summary.failedLogins,    color: 'text-warning-600' },
                  { label: 'Suspicious Entries',value: suspData.summary.suspiciousMetrics, color: 'text-orange-600' },
                  { label: 'Employee Deletions',value: suspData.summary.deletedEmployees, color: 'text-error-700' },
                ].map(({ label, value, color }) => (
                  <Card key={label}>
                    <p className={cn('text-2xl font-bold tabular-nums', color)}>{value}</p>
                    <p className="text-xs text-neutral-500 mt-0.5">{label}</p>
                  </Card>
                ))}
              </div>
              <AuditTable rows={suspData.details} suspicious />
            </>
          )}
        </>
      )}

      {/* Security tab */}
      {auditTab === 'security' && (
        <>
          {secLoading ? <Skeleton className="h-48 w-full" /> : secError ? <ErrorRetry message="Failed to load security report" onRetry={refetchSec} /> : secData && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Total Actions',    value: secData.statistics.totalActions,    color: 'text-neutral-900 dark:text-white' },
                  { label: 'Successful Logins',value: secData.statistics.successfulLogins, color: 'text-success-600' },
                  { label: 'Failed Logins',    value: secData.statistics.failedLogins,    color: 'text-error-600' },
                  { label: 'Suspicious',       value: secData.statistics.suspiciousActivities, color: 'text-warning-600' },
                  { label: 'Unique Users',     value: secData.statistics.uniqueUsers,     color: 'text-primary-600' },
                  { label: 'Unique IPs',       value: secData.statistics.uniqueIPs,       color: 'text-primary-500' },
                ].map(({ label, value, color }) => (
                  <Card key={label}>
                    <p className={cn('text-2xl font-bold tabular-nums', color)}>{value}</p>
                    <p className="text-xs text-neutral-500 mt-0.5">{label}</p>
                  </Card>
                ))}
              </div>
              {secData.highRiskIPs.length > 0 && (
                <Card>
                  <h3 className="mb-3 text-sm font-semibold text-error-700 dark:text-error-300">High-Risk IPs</h3>
                  <div className="space-y-2">
                    {secData.highRiskIPs.map(({ ip, failedAttempts }) => (
                      <div key={ip} className="flex items-center justify-between rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
                        <span className="font-mono text-sm font-medium text-neutral-900 dark:text-white">{ip}</span>
                        <Badge variant="error">{failedAttempts} failed attempts</Badge>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
              <Card>
                <h3 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Recommendations</h3>
                <ul className="space-y-1.5">
                  {secData.recommendations.map((rec, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                      <span className="mt-0.5 shrink-0">{rec.startsWith('✅') ? '✅' : rec.startsWith('⚠️') ? '⚠️' : 'ℹ️'}</span>
                      <span>{rec.replace(/^[✅⚠️ℹ️]\s*/, '')}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs text-neutral-400">Generated: {secData.generatedAt ? new Date(secData.generatedAt).toLocaleString('en-IN') : '—'} · {secData.timeRange}</p>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Tags section ──────────────────────────────────────────────────────────────

interface TagEntry { id: string; label: string; color: string; }

const TAG_PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#22c55e', '#10b981', '#06b6d4', '#3b82f6',
  '#6366f1', '#8b5cf6', '#ec4899', '#64748b',
];

function TagsSection() {
  const qc = useQueryClient();
  const { user } = useAuth();
  // Raw role, matching POST /api/tags's actual checkRole(['admin','manager',
  // 'superadmin']) exactly (DL-021) — defense in depth for whoever reaches
  // this component directly (e.g. B3 audit finding #5's ?tab= bypass, now
  // fixed at the page level, but this holds even if that guard is ever
  // removed or a future caller mounts TagsSection some other way).
  const canCreateTags = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'superadmin';
  const [search, setSearch] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('#6366f1');
  const [showPalette, setShowPalette] = useState(false);
  const [creating, setCreating] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['tag-catalog'],
    queryFn: () => apiFetch<{ success: boolean; tags: TagEntry[] }>('/api/tags'),
    staleTime: 60_000,
  });
  const tags = data?.tags ?? [];
  const filtered = tags.filter((t) => t.label.toLowerCase().includes(search.toLowerCase()));

  const createMut = useMutation({
    mutationFn: ({ label, color }: { label: string; color: string }) =>
      apiFetch('/api/tags', { method: 'POST', body: JSON.stringify({ label, color }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tag-catalog'] });
      setNewLabel('');
      setCreating(false);
      toast.success('Tag created');
    },
    onError: () => toast.error('Failed to create tag'),
  });

  const canCreate =
    newLabel.trim().length > 0 &&
    !tags.some((t) => t.label.toLowerCase() === newLabel.trim().toLowerCase());

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Tag Manager</h2>
        <p className="text-sm text-neutral-500">Centrally manage all contact tags. Tags created here are available across Inbox, Contacts, Sales, and Automation.</p>
      </div>

      {/* Create new tag — hidden entirely for roles POST /api/tags would 403 (finding #7b) */}
      {canCreateTags && (
      <Card>
        <p className="mb-3 text-sm font-semibold text-neutral-800 dark:text-neutral-200">Create New Tag</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-40">
            <label className="mb-1 block text-xs font-medium text-neutral-500">Tag name</label>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canCreate && !creating) { setCreating(true); createMut.mutate({ label: newLabel.trim(), color: newColor }); } }}
              placeholder="e.g. Hot Lead, VIP, Follow Up"
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary-600 focus:ring-1 focus:ring-primary-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">Color</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowPalette((v) => !v)}
                className="relative h-9 w-9 rounded-lg border-2 border-white shadow transition hover:scale-105"
                style={{ backgroundColor: newColor }}
                title="Pick color"
              />
              {showPalette && (
                <div className="flex flex-wrap gap-1.5 rounded-xl border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                  {TAG_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => { setNewColor(c); setShowPalette(false); }}
                      className="h-6 w-6 rounded-full transition hover:scale-110"
                      style={{
                        backgroundColor: c,
                        outline: newColor === c ? `2px solid ${c}` : 'none',
                        outlineOffset: '2px',
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
          <Button
            onClick={() => { setCreating(true); createMut.mutate({ label: newLabel.trim(), color: newColor }); }}
            disabled={!canCreate || createMut.isPending}
            loading={createMut.isPending}
          >
            Create Tag
          </Button>
        </div>
        {newLabel.trim() && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-neutral-400">Preview:</span>
            <span
              className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold"
              style={{ backgroundColor: newColor + '20', color: newColor, borderColor: newColor + '50' }}
            >
              {newLabel.trim()}
            </span>
          </div>
        )}
      </Card>
      )}

      {/* Tag list */}
      <Card noPadding>
        <div className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tags…"
              className="h-8 w-full rounded-lg border border-neutral-200 bg-white pl-8 pr-3 text-sm focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            />
          </div>
          <span className="shrink-0 text-xs text-neutral-400">{tags.length} tags</span>
          <button onClick={() => refetch()} className="shrink-0 text-neutral-400 hover:text-neutral-600" title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {isLoading && (
          <div className="space-y-2 p-4">
            {[0,1,2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        )}

        {isError && (
          <div className="py-8 text-center">
            <p className="text-sm text-error-600 dark:text-error-400">Failed to load tags</p>
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => refetch()}>Retry</Button>
          </div>
        )}

        {!isLoading && !isError && (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {filtered.length === 0 ? (
              <li className="py-10 text-center text-sm text-neutral-400">
                {search ? 'No tags match your search' : 'No tags yet — create your first one above'}
              </li>
            ) : (
              filtered.map((tag) => (
                <li key={tag.id} className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                  <span
                    className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
                    style={{ backgroundColor: tag.color + '20', color: tag.color, borderColor: tag.color + '50' }}
                  >
                    {tag.label}
                  </span>
                  <span className="flex-1 text-sm text-neutral-700 dark:text-neutral-300">{tag.label}</span>
                  <span className="font-mono text-[10px] text-neutral-300 dark:text-neutral-600">{tag.id?.slice(0, 8)}</span>
                </li>
              ))
            )}
          </ul>
        )}
      </Card>

      <p className="text-xs text-neutral-400">
        Tags are shared across all modules. Newly created tags are immediately available in Inbox, Customer360, Broadcast filters, and Automation workflows.
      </p>
    </div>
  );
}

// ── API Keys section ────────────────────────────────────────────────────────
// Admin-only management of the long-lived keys that authenticate the PUBLIC
// form-submission endpoint (POST /api/public/form-submission). Mirrors
// TagsSection's list/isError/Retry pattern and EmployeesSection's one-time
// secret-reveal (the full key is shown exactly once, never retrievable again).
interface ApiKeyEntry {
  keyId: string;
  keyPrefix: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  status: 'active' | 'revoked';
}

function ApiKeysSection() {
  const qc = useQueryClient();
  const [newName, setNewName] = useState('');
  const [freshKey, setFreshKey] = useState<{ key: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => apiFetch<{ success: boolean; keys: ApiKeyEntry[] }>('/api/api-keys'),
    staleTime: 30_000,
  });
  const keys = data?.keys ?? [];

  const generateMut = useMutation({
    mutationFn: (name: string) =>
      apiFetch<{ success: boolean; key: string; name: string }>('/api/api-keys/generate', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['api-keys'] });
      setFreshKey({ key: res.key, name: res.name });
      setNewName('');
      setCopied(false);
      toast.success('API key generated');
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e, 'Failed to generate key')),
  });

  const revokeMut = useMutation({
    mutationFn: (keyId: string) => apiFetch(`/api/api-keys/${keyId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('API key revoked');
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e, 'Failed to revoke key')),
  });

  const copyKey = () => {
    if (!freshKey) return;
    navigator.clipboard.writeText(freshKey.key)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => toast.error('Could not copy — copy it manually'));
  };

  const canGenerate = newName.trim().length > 0;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">API Keys</h2>
        <p className="text-sm text-neutral-500">
          Keys authenticate your landing page&apos;s server when it calls the public form-submission API. Store a key on your
          server only — never expose it in a browser or public page. See the developer docs for the request format.
        </p>
      </div>

      {/* One-time full-key reveal — shown once, never retrievable again */}
      {freshKey && (
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            New key “{freshKey.name}” — shown once
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 select-all break-all rounded-lg bg-neutral-100 px-3 py-2 font-mono text-sm text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100">
              {freshKey.key}
            </code>
            <Button size="sm" variant="secondary" onClick={copyKey}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />{copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            Save this now — it cannot be retrieved later. If you lose it, revoke it and generate a new one.
          </p>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setFreshKey(null)}>
            Done — I&apos;ve saved the key
          </Button>
        </Card>
      )}

      {/* Generate */}
      <Card>
        <p className="mb-3 text-sm font-semibold text-neutral-800 dark:text-neutral-200">Generate a New Key</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-40">
            <label className="mb-1 block text-xs font-medium text-neutral-500">Key name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canGenerate && !generateMut.isPending) generateMut.mutate(newName.trim()); }}
              placeholder="e.g. Landing page — Insta funnel"
              maxLength={80}
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary-600 focus:ring-1 focus:ring-primary-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
          <Button
            onClick={() => generateMut.mutate(newName.trim())}
            disabled={!canGenerate || generateMut.isPending}
            loading={generateMut.isPending}
          >
            Generate Key
          </Button>
        </div>
      </Card>

      {/* Existing keys */}
      <Card noPadding>
        <div className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
          <span className="flex-1 text-sm font-semibold text-neutral-800 dark:text-neutral-200">Your Keys</span>
          <span className="shrink-0 text-xs text-neutral-400">{keys.length} keys</span>
          <button onClick={() => refetch()} className="shrink-0 text-neutral-400 hover:text-neutral-600" title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {isLoading && (
          <div className="space-y-2 p-4">
            {[0,1,2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        )}

        {isError && (
          <div className="py-8 text-center">
            <p className="text-sm text-error-600 dark:text-error-400">Failed to load API keys</p>
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => refetch()}>Retry</Button>
          </div>
        )}

        {!isLoading && !isError && (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {keys.length === 0 ? (
              <li className="py-10 text-center text-sm text-neutral-400">No API keys yet — generate your first one above</li>
            ) : (
              keys.map((k) => (
                <li key={k.keyId} className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">{k.name}</span>
                      {k.status === 'revoked' && <Badge variant="default">Revoked</Badge>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-neutral-400">
                      <span className="font-mono">{k.keyPrefix}…</span>
                      <span>Created {new Date(k.createdAt).toLocaleDateString()}</span>
                      <span>{k.lastUsedAt ? `Last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : 'Never used'}</span>
                    </div>
                  </div>
                  {k.status === 'active' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => { if (window.confirm(`Revoke “${k.name}”? Any server still using it will start getting 401s immediately.`)) revokeMut.mutate(k.keyId); }}
                      disabled={revokeMut.isPending}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              ))
            )}
          </ul>
        )}
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

function SettingsPageInner() {
  const { user, logout } = useAuth();
  // Raw role (not v3Role) for visibleToRoles and isAdmin — DL-021,
  // docs/v3/12_DECISION_LOG.md: display buckets must never be used for
  // permission gating, only raw roles.
  const rawRole = user?.role;
  const isAdmin = rawRole === 'superadmin' || rawRole === 'admin';
  const searchParams = useSearchParams();

  const initialSection = (searchParams.get('tab') as SettingsSection | null) ?? 'profile';
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);

  const visibleSections = SECTIONS.filter((s) => isSectionVisible(s, rawRole, isAdmin));

  // Graceful degradation (docs/v3/09_PERMISSION_MATRIX.md §13.6): a role
  // that lands on an unauthorized ?tab= — the sidebar never renders that
  // button for them, so this only happens via a direct/typed URL — falls
  // back to the first section they can actually see, silently, no error
  // screen. Pure derived value (not an effect + setState) so there's no
  // flash of the unauthorized section's real content on the way to the
  // fallback.
  const requestedSection = SECTIONS.find((s) => s.id === activeSection);
  const effectiveSection: SettingsSection =
    requestedSection && isSectionVisible(requestedSection, rawRole, isAdmin)
      ? activeSection
      : (visibleSections[0]?.id ?? 'profile');

  function renderContent() {
    switch (effectiveSection) {
      case 'profile':       return <ProfileSection />;
      case 'appearance':    return <AppearanceSection />;
      case 'employees':     return <EmployeesSection />;
      case 'whatsapp':      return <WhatsAppSection />;
      case 'templates':     return <SettingsTemplatesSection />;
      case 'ai':            return <AISection />;
      case 'notifications': return <StubSection title="Notifications" description="Manage your notification preferences" />;
      case 'security':      return <StubSection title="Security" description="Password, 2FA, and session management" />;
      case 'organisation':  return <StubSection title="Organisation" description="Company name, logo, and timezone" />;
      case 'pipeline':      return <StubSection title="Pipeline Stages" description="Customise your sales pipeline stages" />;
      case 'tags':          return <TagsSection />;
      case 'api-keys':      return <ApiKeysSection />;
      case 'workflows':     return <StubSection title="Workflow settings" description="Default workflow behaviour" />;
      case 'integrations':  return <StubSection title="Integrations" description="Connect to third-party tools" />;
      case 'billing':       return <StubSection title="Billing & Plan" description="Subscription and payment details" />;
      case 'targets':       return <TargetsSection />;
      case 'metric-config': return <StubSection title="Metric Config" description="Edit metric labels, icons and weights — contact support" />;
      case 'audit':         return <AuditSection />;
      default:              return null;
    }
  }

  return (
    <div className="flex h-full">
      <aside className="hidden w-[240px] shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 md:flex">
        <div className="border-b border-neutral-200 px-4 py-4 dark:border-neutral-800">
          <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Settings</h1>
        </div>
        <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 py-3" aria-label="Settings sections">
          {visibleSections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              aria-current={effectiveSection === section.id ? 'page' : undefined}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                effectiveSection === section.id
                  ? 'bg-primary-50 font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                  : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800',
              )}
            >
              <span className="shrink-0 text-current opacity-70">{section.icon}</span>
              {section.label}
            </button>
          ))}
        </nav>
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

      <main className="scrollbar-thin flex-1 overflow-y-auto p-6">
        {renderContent()}
      </main>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  );
}
