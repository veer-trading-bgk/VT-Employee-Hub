'use client';

// Instagram connect/disconnect panel (GET /config, GET /auth/init popup,
// DELETE /connection). PR4: the single shared component the settings-page
// InstagramSection was extracted into (ADR-022's "definitive extraction").
// The main Settings page no longer renders Instagram at all — this page's own
// Settings tab is now the ONE place it's configured, per the original design
// ("consolidates... replacing the standalone Settings → Instagram panel, not
// duplicating it"). Kept as its own component (not inlined into the page) so
// it stays independently reusable if a future surface ever needs it again.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ExternalLink } from 'lucide-react';
import { apiFetch, apiErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import { Badge, Button, Card, Skeleton } from '@/components/v3/ui';
import { InstagramIcon } from '@/components/icons/BrandIcons';

interface IgConfig {
  connected: boolean;
  igUsername: string | null;
  igBusinessAccountId: string | null;
  connectedAt: string | null;
  tokenExpiresAt: string | null;
}

export function InstagramSettingsPanel() {
  const qc = useQueryClient();
  const [connecting, setConnecting] = useState(false);

  const { data: cfg, isLoading } = useQuery<IgConfig>({
    queryKey: ['instagram-config'],
    queryFn: () => apiFetch<IgConfig>('/api/instagram/config'),
    staleTime: 30_000,
  });

  const disconnectMut = useMutation({
    mutationFn: () => apiFetch('/api/instagram/connection', { method: 'DELETE', retries: 0 }),
    onSuccess: () => {
      toast.success('Instagram disconnected');
      qc.invalidateQueries({ queryKey: ['instagram-config'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Failed to disconnect')),
  });

  async function handleConnect() {
    setConnecting(true);
    try {
      const { url } = await apiFetch<{ url: string }>('/api/instagram/auth/init');
      const popup = window.open(url, 'ig_connect', 'width=600,height=700');
      const onMessage = (e: MessageEvent) => {
        if (e.data?.type === 'ig_connected') {
          toast.success('Instagram connected');
          qc.invalidateQueries({ queryKey: ['instagram-config'] });
          window.removeEventListener('message', onMessage);
        } else if (e.data?.type === 'ig_failed') {
          toast.error(e.data?.message || 'Connection failed');
          window.removeEventListener('message', onMessage);
        }
      };
      window.addEventListener('message', onMessage);
      const timer = window.setInterval(() => {
        if (popup?.closed) {
          window.clearInterval(timer);
          window.removeEventListener('message', onMessage);
          setConnecting(false);
        }
      }, 500);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not start Instagram connection'));
      setConnecting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h2 className="mb-1 text-lg font-semibold text-neutral-800 dark:text-neutral-100">Instagram connection</h2>
      <p className="mb-4 text-sm text-neutral-500">Connect the Instagram professional account whose DMs and comments this workspace manages.</p>

      <Card noPadding>
        <div className="flex items-center gap-4 p-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/30">
            <InstagramIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            {isLoading ? (
              <Skeleton className="h-5 w-40" />
            ) : cfg?.connected ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-neutral-800 dark:text-neutral-100">{cfg.igUsername ? `@${cfg.igUsername}` : 'Connected'}</span>
                  <Badge variant="success" dot>Connected</Badge>
                </div>
                {cfg.connectedAt && <span className="text-xs text-neutral-400">Since {format(new Date(cfg.connectedAt), 'MMM d, yyyy')}</span>}
              </>
            ) : (
              <div className="flex items-center gap-2">
                <span className="font-medium text-neutral-800 dark:text-neutral-100">Not connected</span>
                <Badge variant="default">Disconnected</Badge>
              </div>
            )}
          </div>
          {cfg?.connected ? (
            <Button variant="danger" size="sm" loading={disconnectMut.isPending} onClick={() => disconnectMut.mutate()}>Disconnect</Button>
          ) : (
            <Button size="sm" loading={connecting} iconRight={<ExternalLink className="h-3.5 w-3.5" />} onClick={handleConnect}>Connect Instagram</Button>
          )}
        </div>
      </Card>

      <p className="mt-4 text-xs text-neutral-400">DM keyword auto-replies and comment automations are configured under Automation → Workflows.</p>
    </div>
  );
}
