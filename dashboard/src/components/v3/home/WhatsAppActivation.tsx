'use client';

// Dashboard-level WhatsApp activation surfaces (P0.2): a connection-status
// card and a "getting started" checklist, both reusing data already fetched
// elsewhere in the app (Settings, Inbox, Employees, Automations, Templates)
// via the same React Query keys those pages already own — no new backend
// routes, no duplicated fetch logic.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MessageCircle, CheckCircle2, Circle, ChevronRight,
} from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/v3/ui/Card';
import { Badge, type BadgeVariant } from '@/components/v3/ui/Badge';
import { Button } from '@/components/v3/ui/Button';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { EmbeddedSignupWizard } from '@/components/settings/EmbeddedSignupWizard';
import { computeOverall, type HealthResponse, type RowStatus } from '@/components/settings/MetaHealthPanel';

// Minimal subset of GET /api/whatsapp/config/full's response — the full
// shape is declared in settings/page.tsx (not exported, it's a page module),
// so this mirrors only the fields this card actually reads.
interface WabaConfigSummary {
  connected: boolean;
  phoneNumber: string | null;
  connectedAt: string | null;
  setupMethod: string | null;
}

interface EmbeddedSignupCfg { appId: string; configId: string; graphApiVersion: string }

const HEALTH_BADGE_VARIANT: Record<RowStatus, BadgeVariant> = {
  success: 'success',
  warning: 'warning',
  error: 'error',
  info: 'default',
};

// ── Connection card ──────────────────────────────────────────────────────────

export function WhatsAppConnectionCard() {
  const router = useRouter();
  const qc = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardKey, setWizardKey] = useState(0);

  const { data: cfg, isLoading } = useQuery<WabaConfigSummary>({
    queryKey: ['whatsapp-config-full'],
    queryFn: () => apiFetch<WabaConfigSummary>('/api/whatsapp/config/full'),
  });

  const { data: embeddedSignupCfg } = useQuery<EmbeddedSignupCfg>({
    queryKey: ['embedded-signup-config'],
    queryFn: () => apiFetch<EmbeddedSignupCfg>('/api/whatsapp/embedded-signup/config', { retries: 0 }),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const connected = cfg?.connected ?? false;

  // Only fetched once connected -- this is a live Graph API round trip
  // (same endpoint Settings -> Meta Health calls), no reason to pay for it
  // on a not-yet-connected dashboard.
  const { data: health } = useQuery<HealthResponse>({
    queryKey: ['whatsapp-health'],
    queryFn: () => apiFetch<HealthResponse>('/api/whatsapp/connection/health'),
    enabled: connected,
    staleTime: 60_000,
  });

  function handleConnectClick() {
    if (embeddedSignupCfg) {
      setWizardKey((k) => k + 1);
      setWizardOpen(true);
    } else {
      router.push('/settings?tab=whatsapp');
    }
  }

  if (isLoading) {
    return <Card className="h-40 animate-pulse bg-neutral-50 dark:bg-neutral-900/50" />;
  }

  if (!connected) {
    return (
      <Card className="border-primary-200 bg-primary-50 dark:border-primary-900/30 dark:bg-primary-900/10">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/30">
            <MessageCircle className="h-5 w-5 text-primary-700 dark:text-primary-300" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-primary-900 dark:text-primary-100">Connect WhatsApp</h3>
            <p className="mt-0.5 text-xs text-primary-700 dark:text-primary-300">
              Connect your business WhatsApp number so your team can start chatting with customers —
              takes about 2 minutes.
            </p>
            <Button size="sm" className="mt-3" onClick={handleConnectClick}>
              Connect WhatsApp
            </Button>
          </div>
        </div>
        {embeddedSignupCfg && (
          <EmbeddedSignupWizard
            key={wizardKey}
            open={wizardOpen}
            onClose={() => setWizardOpen(false)}
            onOnboarded={() => {
              qc.invalidateQueries({ queryKey: ['whatsapp-config-full'] });
              qc.invalidateQueries({ queryKey: ['whatsapp-health'] });
            }}
            config={embeddedSignupCfg}
          />
        )}
      </Card>
    );
  }

  const overall = health ? computeOverall(health) : null;
  const businessName = health?.phone?.verifiedName ?? null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-primary-600" aria-hidden />
          <CardTitle>WhatsApp</CardTitle>
        </div>
        <Badge variant="success" dot>Connected</Badge>
      </CardHeader>
      <div className="mt-3 space-y-1.5 text-xs">
        <SummaryRow label="Number" value={cfg?.phoneNumber ?? '—'} />
        <SummaryRow label="Business name" value={businessName ?? '—'} />
        <SummaryRow
          label="Connected"
          value={cfg?.connectedAt
            ? new Date(cfg.connectedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
            : '—'}
        />
        <div className="flex items-center justify-between gap-4 py-1">
          <span className="text-neutral-500">Meta Health</span>
          {overall ? (
            <Badge variant={HEALTH_BADGE_VARIANT[overall.status]}>{overall.label}</Badge>
          ) : (
            <span className="text-neutral-400">Checking…</span>
          )}
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" onClick={() => router.push('/inbox')}>
          Open Inbox
        </Button>
        <Button size="sm" variant="secondary" onClick={() => router.push('/settings?tab=whatsapp')}>
          WhatsApp Settings
        </Button>
      </div>
    </Card>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="text-neutral-500">{label}</span>
      <span className="truncate text-right font-medium text-neutral-800 dark:text-neutral-200">{value}</span>
    </div>
  );
}

// ── Getting Started checklist ────────────────────────────────────────────────
// Company-level WhatsApp activation checklist -- distinct from the existing
// per-employee GettingStartedChecklist on this page (that one tracks a single
// agent's own first CRM actions; this tracks the company's WhatsApp rollout,
// so it's admin-relevant regardless of how long the viewing employee has
// been around). Every signal below is derived from an endpoint some other
// page already calls, reusing the same React Query key so the cache is
// shared rather than duplicated.

interface InboxSummary { conversations: { lastMessageDirection?: string; lastInboundAt?: string | null }[] }
interface EmployeesResponse { data: { id: string }[] }
interface AutomationsResponse { automations: unknown[] }
interface TemplatesResponse { templates: unknown[] }

interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  href: string;
}

export function WhatsAppActivationChecklist() {
  const { data: cfg } = useQuery<WabaConfigSummary>({
    queryKey: ['whatsapp-config-full'],
    queryFn: () => apiFetch<WabaConfigSummary>('/api/whatsapp/config/full'),
  });
  const connected = cfg?.connected ?? false;

  const { data: inbox } = useQuery<InboxSummary>({
    queryKey: ['wa-inbox', 'all'],
    queryFn: () => apiFetch<InboxSummary>('/api/whatsapp/inbox?status=all'),
    enabled: connected,
  });
  const { data: employees } = useQuery<EmployeesResponse>({
    queryKey: ['v3-employees'],
    queryFn: () => apiFetch<EmployeesResponse>('/api/admin/employees'),
  });
  const { data: automations } = useQuery<AutomationsResponse>({
    queryKey: ['automations'],
    queryFn: () => apiFetch<AutomationsResponse>('/api/automations'),
  });
  const { data: templates } = useQuery<TemplatesResponse>({
    queryKey: ['whatsapp-templates'],
    queryFn: () => apiFetch<TemplatesResponse>('/api/whatsapp/templates'),
    enabled: connected,
  });

  const conversations = inbox?.conversations ?? [];
  // Approximation, not an exact send/receive ledger (that would need a new
  // backend aggregate, out of scope here): a conversation exists at all only
  // once at least one message has gone either direction, so "ever received"
  // uses the per-conversation lastInboundAt timestamp, and "ever sent" uses
  // whether any conversation's most recent message was outbound.
  const receivedAny = conversations.some((c) => !!c.lastInboundAt);
  const sentAny = conversations.some((c) => c.lastMessageDirection === 'outbound');

  const items: ChecklistItem[] = [
    { id: 'connect',    label: 'Connect WhatsApp',      done: connected,                                  href: '/settings?tab=whatsapp' },
    { id: 'send',       label: 'Send First Message',    done: sentAny,                                    href: '/inbox' },
    { id: 'receive',    label: 'Receive First Message', done: receivedAny,                                href: '/inbox' },
    { id: 'invite',     label: 'Invite Team Member',    done: (employees?.data?.length ?? 0) > 1,          href: '/settings?tab=employees' },
    { id: 'automation', label: 'Create First Automation', done: (automations?.automations?.length ?? 0) > 0, href: '/automation' },
    { id: 'template',   label: 'Create First Template', done: (templates?.templates?.length ?? 0) > 0,     href: '/settings?tab=templates' },
  ];

  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = Math.round((done / total) * 100);

  return (
    <Card className="border-primary-200 bg-primary-50 dark:border-primary-900/30 dark:bg-primary-900/10">
      <CardHeader>
        <div>
          <CardTitle className="text-primary-800 dark:text-primary-200">Get started with WhatsApp</CardTitle>
          <p className="mt-0.5 text-xs text-primary-600">{done} / {total} Complete</p>
        </div>
        <span className="text-2xl font-bold text-primary-700">{pct}%</span>
      </CardHeader>
      <div className="mt-3 h-1.5 rounded-full bg-primary-200 dark:bg-primary-900">
        <div
          className="h-1.5 rounded-full bg-primary-600 transition-all duration-500"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <ul className="mt-4 space-y-2" role="list">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 text-sm transition-colors',
                item.done
                  ? 'text-neutral-400 line-through'
                  : 'text-primary-700 hover:text-primary-800 dark:text-primary-300',
              )}
            >
              {item.done ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success-600" aria-hidden />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-primary-400" aria-hidden />
              )}
              {item.label}
              {!item.done && <ChevronRight className="ml-auto h-4 w-4" aria-hidden />}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
