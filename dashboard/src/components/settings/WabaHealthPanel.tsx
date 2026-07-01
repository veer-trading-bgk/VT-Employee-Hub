'use client';

import { useState } from 'react';
import { CheckCircle, XCircle, AlertTriangle, RefreshCw, Wrench } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/v3/ui/Card';
import { Button } from '@/components/v3/ui/Button';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WabaHealthResponse {
  success: boolean;
  connected: boolean;
  graphApiVersion: string;
  lastChecked: string;
  config?: {
    wabaId: string | null;
    phoneNumberId: string | null;
    displayNumber: string | null;
    connectedAt: string | null;
    setupMethod: string;
    configValid: boolean;
    configIssue?: string;
  };
  token?: {
    valid: boolean;
    scopes: string[];
    appId: string | null;
    expiresAt: string | null;
  };
  waba?: {
    accessible: boolean;
    id: string | null;
    name: string | null;
    reviewStatus: string | null;
    currency: string | null;
    templateNamespace: string | null;
    businessId: string | null;
  };
  phone?: {
    accessible: boolean;
    id: string | null;
    displayNumber: string | null;
    verifiedName: string | null;
    qualityRating: string | null;
    verificationStatus: string | null;
    status: string | null;
  };
  capabilities?: {
    messaging: boolean;
    templates: boolean;
  };
  issues: string[];
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusRow({ ok, label, warn }: { ok: boolean | undefined; label: string; warn?: boolean }) {
  if (ok === undefined) return null;
  const Icon = ok ? CheckCircle : warn ? AlertTriangle : XCircle;
  const cls = ok
    ? 'text-success-600 dark:text-success-400'
    : warn
    ? 'text-warning-600 dark:text-warning-400'
    : 'text-error-600 dark:text-error-400';
  return (
    <div className="flex items-center gap-2">
      <Icon className={`h-3.5 w-3.5 shrink-0 ${cls}`} />
      <span className={`text-xs font-medium ${cls}`}>{label}</span>
    </div>
  );
}

function InfoRow({ label, value, mono, warn }: { label: string; value: string | null | undefined; mono?: boolean; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-xs">
      <span className="shrink-0 text-neutral-500">{label}</span>
      <span className={`min-w-0 truncate text-right ${mono ? 'font-mono' : ''} ${warn ? 'text-warning-600 dark:text-warning-400' : 'text-neutral-800 dark:text-neutral-200'}`}>
        {value || '—'}
      </span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function WabaHealthPanel() {
  const qc = useQueryClient();
  const [health, setHealth] = useState<WabaHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState(false);

  async function runCheck() {
    setLoading(true);
    try {
      const data = await apiFetch<WabaHealthResponse>('/api/whatsapp/connection/health');
      setHealth(data);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Health check failed');
    } finally {
      setLoading(false);
    }
  }

  async function repairConfig() {
    setRepairing(true);
    try {
      const data = await apiFetch<{ success: boolean; oldWabaId: string; newWabaId: string; message: string }>(
        '/api/whatsapp/connection/repair',
        { method: 'POST' },
      );
      toast.success(`Config repaired — WABA ID updated to ${data.newWabaId}`);
      qc.invalidateQueries({ queryKey: ['whatsapp-connection'] });
      await runCheck();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Repair failed');
    } finally {
      setRepairing(false);
    }
  }

  const isDeprecatedVersion = health?.graphApiVersion === 'v19.0';

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">WABA Health Check</p>
          <p className="text-xs text-neutral-500">Diagnose Meta API connectivity without reading logs</p>
        </div>
        <Button size="sm" variant="secondary" onClick={runCheck} loading={loading}>
          <RefreshCw className="h-3.5 w-3.5" />
          {health ? 'Re-check' : 'Run Check'}
        </Button>
      </div>

      {loading && !health && (
        <div className="mt-4 space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-5 w-full" />)}
        </div>
      )}

      {health && (
        <div className="mt-4 space-y-4">
          {/* Issues banner */}
          {health.issues.length > 0 && (
            <div className="rounded-lg border border-error-200 bg-error-50 p-3 dark:border-error-800 dark:bg-error-900/20">
              <p className="mb-1.5 text-xs font-semibold text-error-700 dark:text-error-300">
                {health.issues.length} issue{health.issues.length > 1 ? 's' : ''} detected
              </p>
              <ul className="space-y-0.5">
                {health.issues.map((issue, i) => (
                  <li key={i} className="text-xs text-error-600 dark:text-error-400">• {issue}</li>
                ))}
              </ul>
              {health.config && !health.config.configValid && (
                <Button size="sm" variant="danger" className="mt-3" loading={repairing} onClick={repairConfig}>
                  <Wrench className="h-3.5 w-3.5" />
                  Repair Config Automatically
                </Button>
              )}
            </div>
          )}

          {/* Status checks */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-neutral-100 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-800/40 sm:grid-cols-3">
            <StatusRow ok={health.config?.configValid} label="Configuration" />
            <StatusRow ok={health.token?.valid} label="Access Token" />
            <StatusRow ok={health.waba?.accessible} label="WABA Accessible" />
            <StatusRow ok={health.phone?.accessible} label="Phone Accessible" />
            <StatusRow ok={health.capabilities?.messaging} label="Messaging" />
            <StatusRow ok={health.capabilities?.templates} label="Templates" />
          </div>

          {/* Detail rows */}
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            <InfoRow label="Graph API Version" value={health.graphApiVersion} warn={isDeprecatedVersion} />
            {isDeprecatedVersion && (
              <div className="py-1.5 text-[10px] text-warning-600 dark:text-warning-400">
                ⚠ v19.0 was deprecated April 2025. Set WHATSAPP_GRAPH_VERSION=v21.0 in Lambda env vars.
              </div>
            )}
            <InfoRow label="App ID" value={health.token?.appId} mono />
            <InfoRow label="Business ID" value={health.waba?.businessId} mono />
            <InfoRow label="WABA ID" value={health.config?.wabaId} mono />
            <InfoRow label="WABA Name" value={health.waba?.name} />
            <InfoRow label="WABA Review Status" value={health.waba?.reviewStatus} />
            <InfoRow label="Phone Number ID" value={health.config?.phoneNumberId} mono />
            <InfoRow label="Display Number" value={health.phone?.displayNumber} />
            <InfoRow label="Verified Name" value={health.phone?.verifiedName} />
            <InfoRow label="Quality Rating" value={health.phone?.qualityRating} />
            <InfoRow label="Token Expires" value={health.token?.expiresAt ? new Date(health.token.expiresAt).toLocaleDateString('en-IN') : 'Never (permanent)'} />
            <InfoRow label="Token Scopes" value={health.token?.scopes?.length ? health.token.scopes.join(', ') : '—'} />
            <InfoRow label="Last Checked" value={new Date(health.lastChecked).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })} />
          </div>
        </div>
      )}
    </Card>
  );
}
