'use client';

import { useState, useCallback } from 'react';
import {
  CheckCircle, XCircle, AlertTriangle, Info, RefreshCw, Wrench,
  ChevronDown, ChevronUp, Send, Copy, ShieldAlert,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/v3/ui/Card';
import { Button } from '@/components/v3/ui/Button';
import { Badge } from '@/components/v3/ui/Badge';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { Input } from '@/components/v3/ui/Input';
import { Select } from '@/components/v3/ui/Select';
import { Drawer, DrawerFooter } from '@/components/v3/ui/Drawer';
import { apiFetch, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { toast } from 'sonner';

// ── Types — mirror the backend response shapes exactly (GET /connection/health,
// POST /repair, POST /send-test, GET /templates) — src/services/graphApiHelpers.js
// (computeHealthSnapshot/autoRepair) and src/routes/whatsapp.js are authoritative. ─

interface HealthSnapshot {
  connected: boolean;
  graphApiVersion?: string;
  config: { wabaId: string | null; phoneNumberId: string | null; displayNumber: string | null; connectedAt: string | null; setupMethod: string; configValid: boolean; configIssue?: string } | null;
  token: { valid: boolean; scopes: string[]; scopesConfirmed: boolean; type: string | null; appId: string | null; expiresAt: string | null } | null;
  waba: { accessible: boolean; id: string | null; name: string | null; reviewStatus: string | null; currency: string | null; templateNamespace: string | null; businessId: string | null } | null;
  phone: { accessible: boolean; id: string | null; displayNumber: string | null; verifiedName: string | null; qualityRating: string | null; verificationStatus: string | null; status: string | null } | null;
  webhooks: { subscribed: boolean; appId: string | null } | null;
  pin: { enabled: boolean; registeredAt: string | null } | null;
  profile: { accessible: boolean; about: string | null; address: string | null; description: string | null; email: string | null; websites: string[]; vertical: string | null; profilePictureUrl: string | null } | null;
  capabilities: { messaging: boolean; templates: boolean; webhooks: boolean; mediaUpload: boolean } | null;
  issues: string[];
  rootCause: string | null;
  recommendedFix: string[];
}

interface HealthResponse extends HealthSnapshot {
  success: boolean;
  lastChecked: string;
}

interface RepairExecuted {
  action: string; label: string; status: 'fixed' | 'failed'; detail?: string; durationMs: number; pinGenerated?: string;
}
interface RepairSkipped {
  action: string; label: string; reason: 'already_healthy' | 'prerequisite_not_met' | 'cooldown_active'; detail?: string;
}
interface RepairResponse {
  success: boolean;
  before: HealthSnapshot;
  repairPlan: { action: string; label: string }[];
  executed: RepairExecuted[];
  skipped: RepairSkipped[];
  after: HealthSnapshot;
  remainingIssues: string[];
  summary: { fixed: number; failed: number; alreadyHealthy: number; otherSkipped: number };
  durationMs: number;
}

interface WaTemplate {
  id: string;
  name: string;
  templateName: string;
  language: string;
  status: string;
}

interface SendTestResponse {
  success: boolean;
  messageId: string;
  timestamp: string;
}

// E.164: '+' followed by 8-15 digits, no leading zero after the '+' — same
// rule POST /send-test itself enforces server-side (src/routes/whatsapp.js).
const E164_REGEX = /^\+[1-9]\d{7,14}$/;

// ── Small presentational helpers ──────────────────────────────────────────────

type RowStatus = 'success' | 'warning' | 'error' | 'info';

const ROW_STYLES: Record<RowStatus, { Icon: typeof CheckCircle; cls: string }> = {
  success: { Icon: CheckCircle, cls: 'text-success-600 dark:text-success-400' },
  warning: { Icon: AlertTriangle, cls: 'text-warning-600 dark:text-warning-400' },
  error: { Icon: XCircle, cls: 'text-error-600 dark:text-error-400' },
  info: { Icon: Info, cls: 'text-neutral-400' },
};

function StatusRow({ status, label, detail }: { status: RowStatus; label: string; detail?: string | null }) {
  const { Icon, cls } = ROW_STYLES[status];
  return (
    <div className="flex items-start gap-2 py-1">
      <Icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${cls}`} aria-hidden />
      <div className="min-w-0">
        <p className={`text-xs font-medium ${cls}`}>{label}</p>
        {detail && <p className="mt-0.5 text-[10px] leading-relaxed text-neutral-500">{detail}</p>}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-xs">
      <span className="shrink-0 text-neutral-500">{label}</span>
      <span className="min-w-0 truncate text-right text-neutral-800 dark:text-neutral-200">{value || '—'}</span>
    </div>
  );
}

function computeOverall(h: HealthSnapshot): { status: RowStatus; label: string } {
  if (!h.connected) return { status: 'error', label: 'Not Connected' };
  if (!h.token?.valid || !h.waba?.accessible || !h.phone?.accessible) {
    return { status: 'error', label: 'Action Required' };
  }
  if (h.issues.length > 0) return { status: 'warning', label: 'Needs Attention' };
  return { status: 'success', label: 'All Systems Healthy' };
}

// ── Main component ────────────────────────────────────────────────────────────

export function MetaHealthPanel() {
  const qc = useQueryClient();

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [showRootCause, setShowRootCause] = useState(false);

  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState<RepairResponse | null>(null);
  const [showRepairDetail, setShowRepairDetail] = useState(true);
  const [revealPin, setRevealPin] = useState<string | null>(null);
  const [pinCopied, setPinCopied] = useState(false);

  const [showSendTest, setShowSendTest] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testTemplateId, setTestTemplateId] = useState('');
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string; messageId?: string } | null>(null);

  const runCheck = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<HealthResponse>('/api/whatsapp/connection/health');
      setHealth(data);
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, 'Health check failed'));
    } finally {
      setLoading(false);
    }
  }, []);

  async function runAutoRepair() {
    setRepairing(true);
    setRepairResult(null);
    try {
      const data = await apiFetch<RepairResponse>('/api/whatsapp/repair', { method: 'POST', retries: 0 });
      setRepairResult(data);
      setShowRepairDetail(true);
      // A fresh Cloud API registration only ever generates a PIN once — this
      // is the one moment it can ever be shown; never persisted client-side
      // beyond this in-memory reveal state, never logged.
      const pinEntry = data.executed.find((e) => e.pinGenerated);
      if (pinEntry?.pinGenerated) {
        setRevealPin(pinEntry.pinGenerated);
        setPinCopied(false);
      }
      if (data.summary.fixed > 0) {
        toast.success(`Auto Repair: fixed ${data.summary.fixed} item${data.summary.fixed > 1 ? 's' : ''}`);
      } else if (data.summary.failed > 0) {
        toast.warning(`Auto Repair: ${data.summary.failed} item${data.summary.failed > 1 ? 's' : ''} could not be fixed`);
      } else {
        toast.success('Auto Repair: everything is already healthy — no changes made');
      }
      // Health state changed (or was confirmed) — refresh the displayed
      // snapshot and let any other consumer of the WhatsApp config re-fetch.
      setHealth((prev) => (prev ? { ...prev, ...data.after } : prev));
      qc.invalidateQueries({ queryKey: ['whatsapp-config-full'] });
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, 'Auto Repair failed'));
    } finally {
      setRepairing(false);
    }
  }

  async function openSendTest() {
    setShowSendTest((v) => !v);
    setSendResult(null);
    if (templates.length === 0 && !templatesLoading) {
      setTemplatesLoading(true);
      try {
        const data = await apiFetch<{ success: boolean; templates: WaTemplate[] }>('/api/whatsapp/templates');
        setTemplates((data.templates ?? []).filter((t) => t.status === 'APPROVED'));
      } catch (e: unknown) {
        toast.error(apiErrorMessage(e, 'Could not load templates'));
      } finally {
        setTemplatesLoading(false);
      }
    }
  }

  async function sendTestMessage() {
    setSendResult(null);
    if (!E164_REGEX.test(testPhone.trim())) {
      setSendResult({ ok: false, message: 'Enter a valid E.164 phone number, e.g. +14155552671' });
      return;
    }
    if (!testTemplateId) {
      setSendResult({ ok: false, message: 'Select an approved template to send' });
      return;
    }
    setSending(true);
    try {
      const data = await apiFetch<SendTestResponse>('/api/whatsapp/send-test', {
        method: 'POST', retries: 0,
        body: JSON.stringify({ toPhone: testPhone.trim(), templateId: testTemplateId }),
      });
      setSendResult({ ok: true, message: 'Test message sent successfully.', messageId: data.messageId });
      toast.success('Test message sent');
    } catch (e: unknown) {
      setSendResult({ ok: false, message: apiErrorMessage(e, 'Failed to send test message') });
    } finally {
      setSending(false);
    }
  }

  function copyPin() {
    if (!revealPin) return;
    navigator.clipboard.writeText(revealPin).then(() => setPinCopied(true));
  }

  const overall = health ? computeOverall(health) : null;

  return (
    <Card data-testid="meta-health-panel">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Meta Health</p>
          <p className="text-xs text-neutral-500">WhatsApp Cloud API status, one-click repair, and test sends</p>
        </div>
        <Button size="sm" variant="secondary" onClick={runCheck} loading={loading} iconLeft={<RefreshCw className="h-3.5 w-3.5" />}>
          Refresh Health
        </Button>
      </div>

      {loading && !health && (
        <div className="mt-4 space-y-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-5 w-full" />)}
        </div>
      )}

      {health && overall && (() => {
        const OverallIcon = ROW_STYLES[overall.status].Icon;
        return (
        <div className="mt-4 space-y-4">

          {/* ── Overall status banner ──────────────────────────────────── */}
          <div
            className={cn(
              'flex items-center justify-between gap-2 rounded-lg border p-3',
              overall.status === 'success' && 'border-success-200 bg-success-50 dark:border-success-800 dark:bg-success-900/20',
              overall.status === 'warning' && 'border-warning-200 bg-warning-50 dark:border-warning-800 dark:bg-warning-900/20',
              overall.status === 'error' && 'border-error-200 bg-error-50 dark:border-error-800 dark:bg-error-900/20',
            )}
          >
            <div className="flex items-center gap-2">
              <OverallIcon className={`h-5 w-5 shrink-0 ${ROW_STYLES[overall.status].cls}`} aria-hidden />
              <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{overall.label}</span>
            </div>
            <Badge variant={overall.status === 'success' ? 'success' : overall.status === 'warning' ? 'warning' : 'error'}>
              {health.issues.length} issue{health.issues.length === 1 ? '' : 's'}
            </Badge>
          </div>

          {/* ── Root cause + recommended fix ───────────────────────────── */}
          {health.rootCause && (
            <div className="rounded-lg border border-warning-200 bg-warning-50 p-3 dark:border-warning-800 dark:bg-warning-900/20">
              <button className="flex w-full items-center justify-between text-left" onClick={() => setShowRootCause((v) => !v)}>
                <p className="text-xs font-semibold text-warning-800 dark:text-warning-200">Root Cause</p>
                {showRootCause ? <ChevronUp className="h-3.5 w-3.5 text-warning-600" /> : <ChevronDown className="h-3.5 w-3.5 text-warning-600" />}
              </button>
              {showRootCause && (
                <>
                  <p className="mt-1.5 text-xs leading-relaxed text-warning-700 dark:text-warning-300">{health.rootCause}</p>
                  {health.recommendedFix.length > 0 && (
                    <div className="mt-2.5">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-warning-700 dark:text-warning-300">Recommended Fix</p>
                      <ol className="space-y-1">
                        {health.recommendedFix.map((step, i) => (
                          <li key={i} className="flex gap-1.5 text-xs text-warning-700 dark:text-warning-300">
                            <span className="shrink-0 font-semibold">{i + 1}.</span>
                            <span className="leading-relaxed">{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Status grid — the 9 individual checks (Overall is the banner above) ── */}
          <div className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-lg border border-neutral-100 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-800/40 sm:grid-cols-2">
            <StatusRow status={health.config?.configValid ? 'success' : 'error'} label="Connection" detail={health.config?.configIssue} />
            <StatusRow status={health.token?.valid ? 'success' : 'error'} label="Access Token" />
            <StatusRow
              status={health.phone?.accessible ? 'success' : 'error'}
              label="Phone Number"
              detail={health.phone?.verificationStatus ? `Verification: ${health.phone.verificationStatus}` : undefined}
            />
            <StatusRow status={health.webhooks?.subscribed ? 'success' : 'warning'} label="Webhook Subscription" />
            <StatusRow
              status={health.pin?.enabled ? 'success' : 'warning'}
              label="Cloud API Registration"
              detail={!health.pin?.enabled ? 'Shares one fix with Two-Step PIN below (both set by the same Meta call)' : undefined}
            />
            <StatusRow status={health.pin?.enabled ? 'success' : 'warning'} label="Two-Step Verification (PIN)" />
            <StatusRow status={health.capabilities?.messaging ? 'success' : 'error'} label="Messaging" />
            <StatusRow status={health.capabilities?.templates ? 'success' : 'warning'} label="Templates" />
            <StatusRow status={health.profile?.accessible ? 'success' : 'warning'} label="Business Profile" />
          </div>

          {/* ── Detail rows ─────────────────────────────────────────────── */}
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            <InfoRow label="WABA ID" value={health.config?.wabaId} />
            <InfoRow label="Phone Number ID" value={health.config?.phoneNumberId} />
            <InfoRow label="Display Number" value={health.phone?.displayNumber} />
            <InfoRow label="Verified Name" value={health.phone?.verifiedName} />
            <InfoRow label="Quality Rating" value={health.phone?.qualityRating} />
            <InfoRow label="Business Profile Email" value={health.profile?.email} />
            <InfoRow label="Business Profile Website" value={health.profile?.websites?.[0]} />
            <InfoRow label="Last Checked" value={health.lastChecked ? new Date(health.lastChecked).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : null} />
          </div>

          {/* ── Actions ─────────────────────────────────────────────────── */}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={runAutoRepair} loading={repairing} iconLeft={<Wrench className="h-3.5 w-3.5" />}>
              Auto Repair
            </Button>
            <Button size="sm" variant="secondary" onClick={openSendTest} iconLeft={<Send className="h-3.5 w-3.5" />}>
              Send Test Message
            </Button>
          </div>

          {/* ── Auto Repair result ──────────────────────────────────────── */}
          {repairResult && (
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-800">
              <button
                className="flex w-full items-center justify-between px-3 py-2 text-left"
                onClick={() => setShowRepairDetail((v) => !v)}
              >
                <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                  Auto Repair Result — {repairResult.summary.fixed} fixed, {repairResult.summary.failed} failed, {repairResult.summary.alreadyHealthy} already healthy
                </span>
                {showRepairDetail ? <ChevronUp className="h-3.5 w-3.5 text-neutral-500" /> : <ChevronDown className="h-3.5 w-3.5 text-neutral-500" />}
              </button>
              {showRepairDetail && (
                <div className="space-y-2 border-t border-neutral-100 px-3 py-2.5 dark:border-neutral-800">
                  {repairResult.executed.map((e) => (
                    <StatusRow
                      key={e.action}
                      status={e.status === 'fixed' ? 'success' : 'error'}
                      label={`${e.status === 'fixed' ? '✓ Fixed' : '✗ Failed'} — ${e.label}`}
                      detail={e.detail}
                    />
                  ))}
                  {repairResult.skipped.map((s) => (
                    <StatusRow
                      key={s.action}
                      status={s.reason === 'already_healthy' ? 'info' : 'warning'}
                      label={`${s.reason === 'already_healthy' ? 'ℹ Already Healthy' : '⚠ Skipped'} — ${s.label}`}
                      detail={s.detail}
                    />
                  ))}
                  <p className="pt-1 text-[10px] text-neutral-400">Completed in {(repairResult.durationMs / 1000).toFixed(1)}s</p>
                  {repairResult.remainingIssues.length > 0 && (
                    <div className="mt-1 rounded-md bg-error-50 p-2 dark:bg-error-900/20">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-error-700 dark:text-error-300">Remaining Issues</p>
                      <ul className="mt-1 space-y-0.5">
                        {repairResult.remainingIssues.map((issue, i) => (
                          <li key={i} className="text-[10px] text-error-600 dark:text-error-400">• {issue}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Send Test Message ──────────────────────────────────────── */}
          {showSendTest && (
            <div className="space-y-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Send Test Message</p>
              <Input
                label="Phone number"
                placeholder="+14155552671"
                hint="E.164 format — country code required"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
              />
              {templatesLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : templates.length === 0 ? (
                <p className="text-xs text-neutral-500">No approved templates yet — approve one in Meta Business Suite, then re-open this panel.</p>
              ) : (
                <Select
                  label="Template"
                  placeholder="Select an approved template"
                  value={testTemplateId}
                  onChange={(e) => setTestTemplateId(e.target.value)}
                  options={templates.map((t) => ({ value: t.id, label: `${t.name} (${t.language})` }))}
                />
              )}
              <Button size="sm" variant="primary" onClick={sendTestMessage} loading={sending} disabled={templates.length === 0} iconLeft={<Send className="h-3.5 w-3.5" />}>
                Send
              </Button>
              {sendResult && (
                <div className={cn('rounded-md p-2 text-xs', sendResult.ok ? 'bg-success-50 text-success-700 dark:bg-success-900/20 dark:text-success-400' : 'bg-error-50 text-error-700 dark:bg-error-900/20 dark:text-error-400')}>
                  <p className="font-medium">{sendResult.message}</p>
                  {sendResult.messageId && <p className="mt-0.5 font-mono text-[10px] opacity-80">{sendResult.messageId}</p>}
                </div>
              )}
            </div>
          )}
        </div>
        );
      })()}

      {/* ── One-time PIN reveal ─────────────────────────────────────────── */}
      <Drawer
        open={!!revealPin}
        onClose={() => setRevealPin(null)}
        title="Two-Step Verification PIN"
        description="Auto Repair just generated this PIN and set it on your WhatsApp account."
        footer={
          <DrawerFooter>
            <Button variant="primary" size="md" onClick={() => setRevealPin(null)}>I&apos;ve saved it, close</Button>
          </DrawerFooter>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3 dark:border-warning-800 dark:bg-warning-900/20">
            <ShieldAlert className="h-4 w-4 shrink-0 text-warning-600 dark:text-warning-400" />
            <p className="text-xs text-warning-700 dark:text-warning-300">
              Record this now — it is shown only once and is never stored anywhere in APForce.
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 rounded-lg bg-neutral-100 py-6 dark:bg-neutral-800">
            <span className="font-mono text-3xl font-bold tracking-[0.3em] text-neutral-900 dark:text-neutral-100">{revealPin}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={copyPin} iconLeft={<Copy className="h-3.5 w-3.5" />} className="w-full">
            {pinCopied ? 'Copied!' : 'Copy PIN'}
          </Button>
        </div>
      </Drawer>
    </Card>
  );
}
