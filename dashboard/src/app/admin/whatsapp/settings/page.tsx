'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import { WhatsAppSubNav } from '@/components/layout/WhatsAppSubNav';

interface WabaConnection {
  connected: boolean;
  phoneNumber?: string;
  wabaId?: string;
  connectedAt?: string;
}

export default function WhatsAppSettingsPage() {
  const queryClient = useQueryClient();

  const [connectMode, setConnectMode] = useState<'oauth' | 'manual'>('manual');
  const [manualToken, setManualToken] = useState('');
  const [manualPhoneId, setManualPhoneId] = useState('');
  const [wabaStatus, setWabaStatus] = useState('');
  const [showTokenHelp, setShowTokenHelp] = useState(false);
  const [welcomeEnabled, setWelcomeEnabled] = useState(false);
  const [welcomeTemplate, setWelcomeTemplate] = useState('');
  const [welcomeLanguage, setWelcomeLanguage] = useState('en');

  const { data: wabaData, isLoading: wabaLoading } = useQuery({
    queryKey: ['waba-connection'],
    queryFn: () => apiFetch<WabaConnection>('/api/whatsapp/connection'),
    staleTime: 60_000,
  });

  const disconnectMutation = useMutation({
    mutationFn: () => apiFetch('/api/whatsapp/connection', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['waba-connection'] }),
  });

  const { data: welcomeData } = useQuery({
    queryKey: ['welcome-config'],
    queryFn: () => apiFetch<{ config: { enabled: boolean; templateName: string; language: string } }>('/api/whatsapp/welcome-config'),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (welcomeData?.config) {
      setWelcomeEnabled(welcomeData.config.enabled);
      setWelcomeTemplate(welcomeData.config.templateName ?? '');
      setWelcomeLanguage(welcomeData.config.language ?? 'en');
    }
  }, [welcomeData]);

  const welcomeMutation = useMutation({
    mutationFn: () => apiFetch('/api/whatsapp/welcome-config', {
      method: 'PUT',
      body: JSON.stringify({ enabled: welcomeEnabled, templateName: welcomeTemplate, language: welcomeLanguage }),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['welcome-config'] }),
  });

  const manualConnectMutation = useMutation({
    mutationFn: () => apiFetch('/api/whatsapp/manual-connect', {
      method: 'POST',
      body: JSON.stringify({ accessToken: manualToken, phoneNumberId: manualPhoneId }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['waba-connection'] });
      setManualToken('');
      setManualPhoneId('');
      setWabaStatus('');
    },
    onError: (err: any) => setWabaStatus(err?.message ?? 'Connection failed — check your credentials'),
  });

  const connectViaOAuth = async () => {
    setWabaStatus('Opening Meta login…');
    try {
      const { url } = await apiFetch<{ url: string }>('/api/whatsapp/auth/init');
      const popup = window.open(url, 'waba_connect', 'width=620,height=700,left=200,top=100');
      if (!popup) { setWabaStatus('Popup blocked — allow popups for this site'); return; }
      const handler = (e: MessageEvent) => {
        if (e.data?.type === 'waba_connected') {
          setWabaStatus('');
          queryClient.invalidateQueries({ queryKey: ['waba-connection'] });
          window.removeEventListener('message', handler);
        } else if (e.data?.type === 'waba_failed') {
          setWabaStatus(`Failed: ${e.data.message}`);
          window.removeEventListener('message', handler);
        }
      };
      window.addEventListener('message', handler);
    } catch {
      setWabaStatus('OAuth not configured — use Manual Setup below instead');
      setConnectMode('manual');
    }
  };

  return (
    <>
      <Navbar title="WhatsApp Settings" showBack />
      <WhatsAppSubNav />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-2xl space-y-6 p-4 pb-10">

          <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-1 text-base font-semibold text-slate-900 dark:text-white">WhatsApp Business</h2>
            <p className="mb-5 text-sm text-slate-500">Connect your WABA to send and receive WhatsApp messages from CRM leads.</p>

            {wabaLoading ? <Loading /> : wabaData?.connected ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                      <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Connected</p>
                    </div>
                    <p className="mt-0.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">{wabaData.phoneNumber}</p>
                    {wabaData.connectedAt && (
                      <p className="text-xs text-emerald-500">
                        Since {new Date(wabaData.connectedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    )}
                  </div>
                  <button onClick={() => { if (confirm('Disconnect WhatsApp?')) disconnectMutation.mutate(); }}
                    className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 dark:border-red-800 dark:bg-slate-800">
                    Disconnect
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Mode toggle */}
                <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800">
                  {(['manual', 'oauth'] as const).map((m) => (
                    <button key={m} onClick={() => setConnectMode(m)}
                      className={`flex-1 rounded-md py-2 text-xs font-semibold transition-colors ${connectMode === m ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-700 dark:text-indigo-400' : 'text-slate-400'}`}>
                      {m === 'manual' ? '🔑 Manual Setup (Recommended)' : '🔗 Meta OAuth (Advanced)'}
                    </button>
                  ))}
                </div>

                {connectMode === 'manual' ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Paste your Meta credentials</p>
                      <button onClick={() => setShowTokenHelp(!showTokenHelp)} className="text-xs text-indigo-500 hover:underline">
                        Where to find these?
                      </button>
                    </div>

                    {showTokenHelp && (
                      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300 space-y-1.5">
                        <p className="font-semibold">How to get your credentials:</p>
                        <p>1. Go to <strong>Meta Business Manager → WhatsApp → API Setup</strong></p>
                        <p>2. Or open <strong>Interakt Dashboard → Developer Settings → API Key</strong> (if using Interakt BSP, use their token)</p>
                        <p>3. <strong>Access Token</strong> — the permanent System User Token (not the temporary one)</p>
                        <p>4. <strong>Phone Number ID</strong> — found under WhatsApp → Phone Numbers in Meta dashboard</p>
                        <p className="mt-1 text-blue-600 dark:text-blue-400">⚠ Use a permanent System User token, not the 24-hr test token</p>
                      </div>
                    )}

                    <div className="space-y-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-500">Access Token (Permanent System User Token)</label>
                        <input
                          type="password"
                          value={manualToken}
                          onChange={(e) => setManualToken(e.target.value)}
                          placeholder="EAAxxxxxxxxxx…"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-500">Phone Number ID</label>
                        <input
                          value={manualPhoneId}
                          onChange={(e) => setManualPhoneId(e.target.value)}
                          placeholder="1234567890123456"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                    </div>

                    {wabaStatus && (
                      <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{wabaStatus}</p>
                    )}

                    <button
                      onClick={() => manualConnectMutation.mutate()}
                      disabled={!manualToken.trim() || !manualPhoneId.trim() || manualConnectMutation.isPending}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#1ebe5c] disabled:opacity-50 active:scale-95 transition-all">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                      {manualConnectMutation.isPending ? 'Verifying…' : 'Connect WhatsApp'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800 text-xs text-slate-500 space-y-1">
                      <p className="font-semibold text-slate-600 dark:text-slate-400">Requires server-level setup:</p>
                      <p>• <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">META_APP_ID</code> and <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">META_APP_SECRET</code> in server .env</p>
                      <p>• <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">BACKEND_URL</code> set to live server URL</p>
                      <p>• Meta App must be in <strong>Live mode</strong></p>
                    </div>
                    {wabaStatus && (
                      <p className={`rounded-lg p-3 text-sm ${wabaStatus.includes('Failed') || wabaStatus.includes('not configured') ? 'bg-red-50 text-red-600 dark:bg-red-900/20' : 'bg-blue-50 text-blue-600 dark:bg-blue-900/20'}`}>
                        {wabaStatus}
                      </p>
                    )}
                    <button onClick={connectViaOAuth}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1877F2] py-3 text-sm font-semibold text-white hover:bg-[#166fe5] active:scale-95 transition-all">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                      Continue with Meta
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Welcome Message */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-1 text-sm font-bold text-slate-900 dark:text-white">Welcome Message</h2>
            <p className="mb-4 text-xs text-slate-400">Auto-send a WhatsApp template when a new contact messages for the first time.</p>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Enable welcome message</p>
                <p className="text-xs text-slate-400">Fires once per new contact</p>
              </div>
              <button onClick={() => setWelcomeEnabled((v) => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${welcomeEnabled ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${welcomeEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            {welcomeEnabled && (
              <div className="mt-3 space-y-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Meta Template Name (exact slug)</label>
                  <input value={welcomeTemplate} onChange={(e) => setWelcomeTemplate(e.target.value)}
                    placeholder="e.g. hello_world"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Language code</label>
                  <input value={welcomeLanguage} onChange={(e) => setWelcomeLanguage(e.target.value)}
                    placeholder="en"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                </div>
              </div>
            )}

            <button onClick={() => welcomeMutation.mutate()} disabled={welcomeMutation.isPending}
              className="mt-4 rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {welcomeMutation.isPending ? 'Saving…' : welcomeMutation.isSuccess ? 'Saved ✓' : 'Save Welcome Config'}
            </button>
          </section>

        </div>
      </div>
    </>
  );
}
