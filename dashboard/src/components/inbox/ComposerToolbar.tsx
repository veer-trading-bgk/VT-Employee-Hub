'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Smile, FileText, Zap, Paperclip, MoreHorizontal, Search, X,
  Image as ImageIcon, Video, Music, File, List, MousePointerClick,
  ShoppingBag, CreditCard, Loader2, Send as SendIcon, Workflow, MapPin,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import type { Branch } from '@/components/automation/BranchSelect';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ComposerConversation {
  type: 'lead' | 'unknown';
  leadId?: string;
  PK?: string;
  name?: string;
  displayName?: string;
  phone: string;
  stage?: string | null;
  assignedToName?: string | null;
}

interface WaTpl {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  bodyPreview: string;
  variables: string[];
}

interface CannedResponse {
  id: string;
  title: string;
  body: string;
  shortcut?: string;
}

interface WaFlow {
  flowId: string;
  name: string;
}

// POST /api/whatsapp/inbox/suggest-reply's response shape (AI Template
// Suggestions in Chat). hasSuggestion: false covers three distinct server-side
// reasons (no approved templates, model found no good fit, or the pick is held
// for Approval on low confidence — no send-from-Approval pipeline in v1, so
// that case is indistinguishable here from "no suggestion" by design) — the
// UI doesn't need to tell them apart, so `reason` is read but not branched on.
interface SuggestReplyResponse {
  success: boolean;
  hasSuggestion: boolean;
  reason?: string;
  template?: { id: string; name: string; bodyPreview: string; variables: string[] };
  variableValues?: string[];
  reasoning?: string;
  confidence?: number;
}

type Panel = null | 'emoji' | 'template' | 'quickreply' | 'attachment' | 'more';

// ── Emoji data ─────────────────────────────────────────────────────────────────

const EMOJI_GRID = [
  ['😊','😂','😍','🥰','😘','😉','😎','🤩','🥳','😁','😄','🤣','😆','🙂','🤗','😇'],
  ['😅','😓','😤','😢','😭','😡','🤔','🤨','😶','🙄','😏','😒','🥺','😳','🤯','😱'],
  ['👍','👎','👏','🙌','🤝','🙏','✌️','💪','👋','👌','🤞','🫶','❤️','🧡','💛','💚'],
  ['💯','🔥','⭐','✅','❌','🎉','🎊','🎁','🎶','🚀','💡','🔔','📱','💬','🏆','🌈'],
];

const RECENT_KEY = 'apforce_recent_emojis';
function getRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; }
}
function pushRecent(e: string) {
  try {
    const r = getRecent().filter((x) => x !== e);
    localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...r].slice(0, 16)));
  } catch {}
}

// ── Auto-fill template variables from contact data ─────────────────────────────

function autoFill(variables: string[], conv: ComposerConversation): string[] {
  const name = conv.displayName || conv.name || conv.phone;
  return variables.map((label) => {
    const l = label.toLowerCase();
    if (l.includes('name') || l.includes('customer') || l.includes('client')) return name;
    if (l.includes('phone') || l.includes('mobile') || l.includes('number')) return conv.phone;
    if (l.includes('stage') || l.includes('status')) return conv.stage ?? '';
    if (l.includes('agent') || l.includes('employee') || l.includes('assign')) return conv.assignedToName ?? '';
    return '';
  });
}

// ── Shared toolbar button ──────────────────────────────────────────────────────

function ToolBtn({
  active, disabled, onClick, icon, label,
}: {
  active: boolean; disabled: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 transition-colors',
        'hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40',
        'dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300',
        active && 'bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400',
      )}
    >
      {icon}
    </button>
  );
}

// ── Panel close button ─────────────────────────────────────────────────────────

function CloseBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-200">
      <X className="h-3.5 w-3.5" />
    </button>
  );
}

// ── Shared panel wrapper ───────────────────────────────────────────────────────

function Panel({ children, width = 'w-80' }: { children: React.ReactNode; width?: string }) {
  return (
    <div className={cn(
      'absolute bottom-full left-0 z-50 mb-1 rounded-xl border border-neutral-200 bg-white shadow-lg',
      'dark:border-neutral-700 dark:bg-neutral-900',
      'animate-panel-in',
      width,
    )}>
      {children}
    </div>
  );
}

function PanelHeader({ title, onClose, children }: { title: string; onClose: () => void; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
      <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{title}</span>
      <div className="flex items-center gap-2">
        {children}
        <CloseBtn onClick={onClose} />
      </div>
    </div>
  );
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="border-b border-neutral-100 px-2 py-2 dark:border-neutral-800">
      <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 dark:border-neutral-700 dark:bg-neutral-800">
        <Search className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-xs outline-none placeholder:text-neutral-400 dark:text-neutral-100"
        />
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export interface ComposerToolbarProps {
  conversation: ComposerConversation;
  draft: string;
  onDraftChange: (v: string) => void;
  onFileAccept: (accept: string) => void;
  onTemplateSent: () => void;
  disabled: boolean;
}

export function ComposerToolbar({
  conversation, draft, onDraftChange, onFileAccept, onTemplateSent, disabled,
}: ComposerToolbarProps) {
  const qc = useQueryClient();
  const [panel, setPanel] = useState<Panel>(null);
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
  const [tplSearch, setTplSearch] = useState('');
  const [pendingTpl, setPendingTpl] = useState<WaTpl | null>(null);
  const [tplVars, setTplVars] = useState<string[]>([]);
  const [qrSearch, setQrSearch] = useState('');
  const [showCannedCreate, setShowCannedCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newShortcut, setNewShortcut] = useState('');
  const [newBody, setNewBody] = useState('');
  const [showFlowPicker, setShowFlowPicker] = useState(false);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  // AI Template Suggestions in Chat — independent of `panel` (a suggestion can
  // sit above the composer regardless of which toolbar panel, if any, is open).
  const [suggestion, setSuggestion] = useState<SuggestReplyResponse | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close panel on outside click
  useEffect(() => {
    if (!panel) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closePanel();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [panel]);

  function closePanel() {
    setPanel(null);
    setPendingTpl(null);
    setTplSearch('');
    setQrSearch('');
    setShowCannedCreate(false);
    setNewTitle('');
    setNewShortcut('');
    setNewBody('');
    setShowFlowPicker(false);
    setShowBranchPicker(false);
  }

  function togglePanel(p: Panel) {
    if (panel === p) { closePanel(); return; }
    setPendingTpl(null);
    setTplSearch('');
    setQrSearch('');
    setShowCannedCreate(false);
    setNewTitle('');
    setNewShortcut('');
    setNewBody('');
    setShowFlowPicker(false);
    setPanel(p);
  }

  const convKey = conversation.leadId ?? conversation.phone;

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: tplData, isLoading: tplLoading } = useQuery({
    queryKey: ['wa-templates'],
    queryFn: () => apiFetch<{ templates: WaTpl[] }>('/api/whatsapp/templates'),
    staleTime: 60_000,
    enabled: panel === 'template',
  });

  const approved = (tplData?.templates ?? []).filter((t) => t.status === 'APPROVED');
  const filteredTpls = tplSearch
    ? approved.filter((t) =>
        t.name.toLowerCase().includes(tplSearch.toLowerCase()) ||
        t.bodyPreview.toLowerCase().includes(tplSearch.toLowerCase()),
      )
    : approved;

  const { data: cannedData, isLoading: cannedLoading } = useQuery({
    queryKey: ['wa-canned'],
    queryFn: () => apiFetch<{ responses: CannedResponse[] }>('/api/whatsapp/inbox/canned'),
    staleTime: 120_000,
    enabled: panel === 'quickreply',
  });

  const canned = (cannedData?.responses ?? []).filter((c) =>
    !qrSearch ||
    c.title.toLowerCase().includes(qrSearch.toLowerCase()) ||
    c.body.toLowerCase().includes(qrSearch.toLowerCase()) ||
    c.shortcut?.toLowerCase().includes(qrSearch.toLowerCase()),
  );

  // Flows are lead-scoped only (no unknown-contact send-flow endpoint) — same
  // query key ['whatsapp-flows'] as the Settings registration panel, so a
  // just-registered flow shows up here without an extra fetch.
  const canSendFlow = conversation.type === 'lead' && !!conversation.leadId;
  const { data: flowsData, isLoading: flowsLoading } = useQuery({
    queryKey: ['whatsapp-flows'],
    queryFn: () => apiFetch<{ flows: WaFlow[] }>('/api/whatsapp/flows'),
    staleTime: 60_000,
    enabled: showFlowPicker,
  });
  const flows = flowsData?.flows ?? [];

  // Same ['wa-branches'] cache key BranchSelect.tsx/BranchesPanel.tsx/
  // SendLocationNode.tsx already use — a cache hit, not a new fetch, if the
  // Settings > WhatsApp > Branches panel was already opened this session.
  const { data: branchesData, isLoading: branchesLoading } = useQuery({
    queryKey: ['wa-branches'],
    queryFn: () => apiFetch<{ branches: Branch[] }>('/api/whatsapp/branches'),
    staleTime: 60_000,
    enabled: showBranchPicker,
  });
  const branches = branchesData?.branches ?? [];

  // ── Template send mutation ─────────────────────────────────────────────────

  const sendTplMut = useMutation({
    mutationFn: ({ templateId, vars }: { templateId: string; vars: string[] }) => {
      const body: Record<string, unknown> = { templateId, variableValues: vars };
      if (conversation.type === 'lead' && conversation.PK) body.leadPK = conversation.PK;
      else body.phone = conversation.phone;
      return apiFetch('/api/whatsapp/send-template', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => {
      toast.success('Template sent');
      closePanel();
      setSuggestion(null); // no-op unless this send came from the suggestion chip
      qc.invalidateQueries({ queryKey: ['wa-conv', convKey] });
      qc.invalidateQueries({ queryKey: ['wa-inbox'] });
      onTemplateSent();
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to send template'),
  });

  // ── AI Template Suggestions in Chat — on-demand, agent-triggered ──────────
  // customerFacing: true, autonomous: true (aiConfig.js's inbox-template-
  // suggestion useCase) — the agent clicking "Suggest a reply" and then
  // reviewing the result before Send is the human-in-the-loop; a low-confidence
  // pick is held for Approval server-side and simply comes back as
  // hasSuggestion: false here, indistinguishable from "no good fit" by design.
  const suggestMut = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      if (conversation.type === 'lead' && conversation.PK) body.leadPK = conversation.PK;
      else body.phone = conversation.phone;
      return apiFetch<SuggestReplyResponse>('/api/whatsapp/inbox/suggest-reply', {
        method: 'POST', body: JSON.stringify(body),
      });
    },
    onSuccess: (res) => {
      // The inline card (rendered below, for both outcomes) is the actual
      // "no confident suggestion" surface — no separate toast, to avoid
      // showing the same message twice.
      setSuggestion(res);
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to get a suggestion'),
  });

  const sendFlowMut = useMutation({
    mutationFn: (flowId: string) =>
      apiFetch(`/api/whatsapp/inbox/${conversation.leadId}/send-flow`, {
        method: 'POST',
        body: JSON.stringify({ flowId }),
      }),
    onSuccess: () => {
      toast.success('Flow sent');
      closePanel();
      qc.invalidateQueries({ queryKey: ['wa-conv', convKey] });
      qc.invalidateQueries({ queryKey: ['wa-inbox'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to send flow'),
  });

  // "Send Location" (Item 1c) — same target-resolution shape /send-template
  // already uses (leadPK > leadId > phone), so this works for both CRM leads
  // and unknown contacts, unlike Send Flow which is lead-scoped only.
  const sendLocationMut = useMutation({
    mutationFn: (branchId: string) => {
      const body: Record<string, unknown> = { branchId };
      if (conversation.type === 'lead' && conversation.PK) body.leadPK = conversation.PK;
      else body.phone = conversation.phone;
      return apiFetch('/api/whatsapp/send-location', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => {
      toast.success('Location sent');
      closePanel();
      qc.invalidateQueries({ queryKey: ['wa-conv', convKey] });
      qc.invalidateQueries({ queryKey: ['wa-inbox'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to send location'),
  });

  const createCannedMut = useMutation({
    mutationFn: () => apiFetch('/api/whatsapp/inbox/canned', {
      method: 'POST',
      body: JSON.stringify({
        title: newTitle.trim(),
        body: newBody.trim(),
        ...(newShortcut.trim() ? { shortcut: newShortcut.trim().replace(/^\//, '') } : {}),
      }),
    }),
    onSuccess: () => {
      toast.success('Quick reply created');
      qc.invalidateQueries({ queryKey: ['wa-canned'] });
      setShowCannedCreate(false);
      setNewTitle('');
      setNewShortcut('');
      setNewBody('');
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to create quick reply'),
  });

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleEmoji(emoji: string) {
    onDraftChange(draft + emoji);
    pushRecent(emoji);
    setRecentEmojis(getRecent()); // refresh from localStorage (called from click handler — no effect)
  }

  function handleTplSelect(t: WaTpl) {
    const filled = autoFill(t.variables, conversation);
    const needsInput = t.variables.length > 0 && filled.some((v) => !v);
    if (!needsInput) {
      sendTplMut.mutate({ templateId: t.id, vars: filled });
    } else {
      setPendingTpl(t);
      setTplVars(filled);
    }
  }

  function handleQrSelect(cr: CannedResponse) {
    const name = conversation.displayName || conversation.name || conversation.phone;
    onDraftChange(cr.body.replace(/\{\{name\}\}/gi, name).replace(/\{\{customer\}\}/gi, name));
    closePanel();
  }

  // Indices where auto-fill couldn't resolve a value
  const unresolvedIdx = pendingTpl
    ? pendingTpl.variables.map((_, i) => i).filter((i) => !tplVars[i])
    : [];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} className="relative">

      {/* ── Toolbar row ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 pb-2">
        <ToolBtn
          active={panel === 'emoji'}
          disabled={disabled}
          onClick={() => { if (panel !== 'emoji') setRecentEmojis(getRecent()); togglePanel('emoji'); }}
          icon={<Smile className="h-4 w-4" />}
          label="Emoji"
        />
        <ToolBtn active={panel === 'template'} disabled={disabled} onClick={() => togglePanel('template')} icon={<FileText className="h-4 w-4" />} label="Templates" />
        <ToolBtn active={panel === 'quickreply'} disabled={disabled} onClick={() => togglePanel('quickreply')} icon={<Zap className="h-4 w-4" />} label="Quick Replies" />
        <ToolBtn active={panel === 'attachment'} disabled={disabled} onClick={() => togglePanel('attachment')} icon={<Paperclip className="h-4 w-4" />} label="Attachments" />
        <ToolBtn active={panel === 'more'} disabled={disabled} onClick={() => togglePanel('more')} icon={<MoreHorizontal className="h-4 w-4" />} label="More" />
        <ToolBtn
          active={false}
          disabled={disabled || suggestMut.isPending}
          onClick={() => suggestMut.mutate()}
          icon={suggestMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          label="Suggest a reply"
        />
      </div>

      {/* ── AI suggestion chip — on-demand, one at a time, above the textarea ── */}
      {suggestion?.hasSuggestion && suggestion.template && (
        <div className="mb-2 rounded-xl border border-primary-200 bg-primary-50 p-3 dark:border-primary-900/40 dark:bg-primary-900/10">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-600 dark:text-primary-400" aria-hidden />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-primary-700 dark:text-primary-300">{suggestion.template.name}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-xs text-primary-900/90 dark:text-primary-100/90">
                  {suggestion.template.bodyPreview.replace(/\{\{(\d+)\}\}/g, (_, n) =>
                    suggestion.variableValues?.[parseInt(n, 10) - 1] || `{{${n}}}`)}
                </p>
                {suggestion.reasoning && (
                  <p className="mt-1 text-[10px] text-primary-600/80 dark:text-primary-400/70">{suggestion.reasoning}</p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSuggestion(null)}
              aria-label="Dismiss suggestion"
              className="shrink-0 text-primary-400 hover:text-primary-600 dark:hover:text-primary-300"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => sendTplMut.mutate({ templateId: suggestion.template!.id, vars: suggestion.variableValues ?? [] })}
              disabled={sendTplMut.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {sendTplMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <SendIcon className="h-3 w-3" />}
              Send
            </button>
            <button
              type="button"
              onClick={() => setSuggestion(null)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-100 dark:text-primary-300 dark:hover:bg-primary-900/20"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {suggestion && !suggestion.hasSuggestion && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800/60">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">No confident suggestion right now.</p>
          <button
            type="button"
            onClick={() => setSuggestion(null)}
            aria-label="Dismiss"
            className="shrink-0 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}

      {/* ── Emoji panel ──────────────────────────────────────────────────── */}
      {panel === 'emoji' && (
        <Panel width="w-72">
          <PanelHeader title="Emoji" onClose={closePanel} />
          <div className="p-2">
            {recentEmojis.length > 0 && (
              <>
                <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Recent</p>
                <div className="mb-2 flex flex-wrap">
                  {recentEmojis.map((e) => (
                    <button key={e} onClick={() => handleEmoji(e)}
                      className="flex h-8 w-8 items-center justify-center rounded text-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
                      {e}
                    </button>
                  ))}
                </div>
              </>
            )}
            <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">All</p>
            <div className="max-h-44 overflow-y-auto">
              {EMOJI_GRID.map((row, ri) => (
                <div key={ri} className="flex flex-wrap">
                  {row.map((e) => (
                    <button key={e} onClick={() => handleEmoji(e)}
                      className="flex h-8 w-8 items-center justify-center rounded text-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
                      {e}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </Panel>
      )}

      {/* ── Template panel ───────────────────────────────────────────────── */}
      {panel === 'template' && (
        <Panel>
          <PanelHeader title={pendingTpl ? pendingTpl.name : 'Templates'} onClose={closePanel}>
            {pendingTpl && (
              <button
                onClick={() => { setPendingTpl(null); setTplVars([]); }}
                className="text-xs text-primary-600 hover:underline dark:text-primary-400"
              >
                ← Back
              </button>
            )}
          </PanelHeader>

          {!pendingTpl && (
            <>
              <SearchInput value={tplSearch} onChange={setTplSearch} placeholder="Search templates…" />
              <div className="max-h-56 overflow-y-auto p-1">
                {tplLoading || sendTplMut.isPending ? (
                  <div className="flex items-center justify-center gap-2 py-6">
                    <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
                    <span className="text-xs text-neutral-400">{sendTplMut.isPending ? 'Sending…' : 'Loading templates…'}</span>
                  </div>
                ) : filteredTpls.length === 0 ? (
                  <p className="py-4 text-center text-xs text-neutral-400">
                    {tplSearch ? 'No templates match your search' : 'No approved templates found'}
                  </p>
                ) : filteredTpls.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => handleTplSelect(t)}
                    disabled={sendTplMut.isPending}
                    className="w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:hover:bg-neutral-800"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">{t.name}</span>
                      <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[9px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                        {t.language}
                      </span>
                    </div>
                    {t.bodyPreview && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-neutral-500">{t.bodyPreview}</p>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          {pendingTpl && (
            <div className="space-y-3 p-3">
              <p className="text-[11px] text-neutral-500">
                Fill in the missing fields to send this template.
              </p>
              {unresolvedIdx.map((i) => (
                <div key={i}>
                  <label className="mb-1 block text-[10px] font-medium text-neutral-500">
                    {pendingTpl.variables[i] || `Variable {{${i + 1}}}`}
                  </label>
                  <input
                    value={tplVars[i] ?? ''}
                    onChange={(e) => {
                      const next = [...tplVars];
                      next[i] = e.target.value;
                      setTplVars(next);
                    }}
                    placeholder={`Enter ${pendingTpl.variables[i] || `value ${i + 1}`}…`}
                    className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs outline-none focus:border-primary-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  />
                </div>
              ))}
              <button
                onClick={() => sendTplMut.mutate({ templateId: pendingTpl.id, vars: tplVars })}
                disabled={sendTplMut.isPending || unresolvedIdx.some((i) => !tplVars[i]?.trim())}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary-600 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {sendTplMut.isPending
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending…</>
                  : <><SendIcon className="h-3.5 w-3.5" /> Send Template</>}
              </button>
            </div>
          )}
        </Panel>
      )}

      {/* ── Quick Replies panel ──────────────────────────────────────────── */}
      {panel === 'quickreply' && (
        <Panel>
          <PanelHeader title={showCannedCreate ? 'New Quick Reply' : 'Quick Replies'} onClose={closePanel}>
            {showCannedCreate ? (
              <button
                onClick={() => { setShowCannedCreate(false); setNewTitle(''); setNewShortcut(''); setNewBody(''); }}
                className="text-xs text-primary-600 hover:underline dark:text-primary-400"
              >
                ← Back
              </button>
            ) : (
              <button
                onClick={() => setShowCannedCreate(true)}
                className="text-xs font-medium text-primary-600 hover:underline dark:text-primary-400"
              >
                + Create
              </button>
            )}
          </PanelHeader>

          {showCannedCreate ? (
            <div className="space-y-2.5 p-3">
              <div>
                <label className="mb-1 block text-[10px] font-medium text-neutral-500">Title *</label>
                <input
                  autoFocus
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Payment Confirmation"
                  className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs outline-none focus:border-primary-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-medium text-neutral-500">Shortcut <span className="font-normal text-neutral-400">(optional)</span></label>
                <input
                  value={newShortcut}
                  onChange={(e) => setNewShortcut(e.target.value)}
                  placeholder="/shortcut"
                  className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs outline-none focus:border-primary-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-medium text-neutral-500">Message *</label>
                <textarea
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder="Type your reply… Use {{name}} for contact name."
                  rows={3}
                  className="w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs outline-none focus:border-primary-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
              </div>
              <button
                onClick={() => createCannedMut.mutate()}
                disabled={!newTitle.trim() || !newBody.trim() || createCannedMut.isPending}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary-600 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {createCannedMut.isPending
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
                  : 'Save Quick Reply'}
              </button>
            </div>
          ) : (
            <>
              <SearchInput value={qrSearch} onChange={setQrSearch} placeholder="Search quick replies…" />
              <div className="max-h-56 overflow-y-auto p-1">
                {cannedLoading ? (
                  <div className="flex items-center justify-center gap-2 py-6">
                    <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
                    <span className="text-xs text-neutral-400">Loading…</span>
                  </div>
                ) : canned.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-6 text-center">
                    <Zap className="h-6 w-6 text-neutral-200 dark:text-neutral-700" />
                    <p className="text-xs text-neutral-400">
                      {qrSearch ? 'No matches found.' : 'No quick replies yet.'}
                    </p>
                    {!qrSearch && (
                      <button
                        onClick={() => setShowCannedCreate(true)}
                        className="flex items-center gap-1.5 rounded-lg border border-dashed border-primary-300 px-3 py-1.5 text-xs font-medium text-primary-600 hover:bg-primary-50 dark:border-primary-700 dark:text-primary-400 dark:hover:bg-primary-900/20"
                      >
                        + Create Quick Reply
                      </button>
                    )}
                  </div>
                ) : canned.map((cr) => (
                  <button
                    key={cr.id}
                    onClick={() => handleQrSelect(cr)}
                    className="w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">{cr.title}</span>
                      {cr.shortcut && (
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[9px] text-neutral-500 dark:bg-neutral-800">
                          /{cr.shortcut}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-neutral-500">{cr.body}</p>
                  </button>
                ))}
              </div>
            </>
          )}
        </Panel>
      )}

      {/* ── Attachment panel ─────────────────────────────────────────────── */}
      {panel === 'attachment' && (
        <Panel width="w-48">
          <PanelHeader title="Attach" onClose={closePanel} />
          <div className="p-1">
            {([
              { label: 'Image',    accept: 'image/*',                                       icon: <ImageIcon className="h-4 w-4" /> },
              { label: 'Video',    accept: 'video/*',                                       icon: <Video     className="h-4 w-4" /> },
              { label: 'Document', accept: 'application/pdf,.doc,.docx,.xls,.xlsx',         icon: <File      className="h-4 w-4" /> },
              { label: 'Audio',    accept: 'audio/*',                                       icon: <Music     className="h-4 w-4" /> },
            ] as const).map(({ label, accept, icon }) => (
              <button
                key={label}
                onClick={() => { onFileAccept(accept); closePanel(); }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <span className="text-neutral-400 dark:text-neutral-500">{icon}</span>
                {label}
              </button>
            ))}
          </div>
        </Panel>
      )}

      {/* ── More panel ───────────────────────────────────────────────────── */}
      {panel === 'more' && (
        <Panel width="w-64">
          <PanelHeader title={showFlowPicker ? 'Send WhatsApp Flow' : showBranchPicker ? 'Send Location' : 'More'} onClose={closePanel}>
            {(showFlowPicker || showBranchPicker) && (
              <button
                onClick={() => { setShowFlowPicker(false); setShowBranchPicker(false); }}
                className="text-xs text-primary-600 hover:underline dark:text-primary-400"
              >
                ← Back
              </button>
            )}
          </PanelHeader>

          {showFlowPicker ? (
            <div className="max-h-56 overflow-y-auto p-1">
              {flowsLoading || sendFlowMut.isPending ? (
                <div className="flex items-center justify-center gap-2 py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
                  <span className="text-xs text-neutral-400">{sendFlowMut.isPending ? 'Sending…' : 'Loading flows…'}</span>
                </div>
              ) : flows.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-neutral-400">
                  No Flows registered yet. Add one in Settings → WhatsApp.
                </p>
              ) : flows.map((f) => (
                <button
                  key={f.flowId}
                  onClick={() => sendFlowMut.mutate(f.flowId)}
                  disabled={sendFlowMut.isPending}
                  className="w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:hover:bg-neutral-800"
                >
                  <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">{f.name}</span>
                </button>
              ))}
            </div>
          ) : showBranchPicker ? (
            <div className="max-h-56 overflow-y-auto p-1">
              {branchesLoading || sendLocationMut.isPending ? (
                <div className="flex items-center justify-center gap-2 py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
                  <span className="text-xs text-neutral-400">{sendLocationMut.isPending ? 'Sending…' : 'Loading branches…'}</span>
                </div>
              ) : branches.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-neutral-400">
                  No branches saved yet. Add one in Settings → WhatsApp.
                </p>
              ) : branches.map((b) => (
                <button
                  key={b.branchId}
                  onClick={() => sendLocationMut.mutate(b.branchId)}
                  disabled={sendLocationMut.isPending}
                  className="w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:hover:bg-neutral-800"
                >
                  <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">{b.name}</span>
                  {b.address && <p className="mt-0.5 truncate text-[11px] text-neutral-500">{b.address}</p>}
                </button>
              ))}
            </div>
          ) : (
            <div className="p-1">
              <button
                onClick={() => { if (canSendFlow) setShowFlowPicker(true); }}
                disabled={!canSendFlow}
                title={canSendFlow ? undefined : 'Available for CRM leads only'}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <span className="text-neutral-400 dark:text-neutral-500"><Workflow className="h-4 w-4" /></span>
                Send Flow
              </button>
              <button
                onClick={() => setShowBranchPicker(true)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <span className="text-neutral-400 dark:text-neutral-500"><MapPin className="h-4 w-4" /></span>
                Send Location
              </button>
              {([
                { label: 'Interactive List', icon: <List              className="h-4 w-4" /> },
                { label: 'CTA Button',       icon: <MousePointerClick className="h-4 w-4" /> },
                { label: 'Catalog',          icon: <ShoppingBag       className="h-4 w-4" /> },
                { label: 'Payment',          icon: <CreditCard        className="h-4 w-4" /> },
              ] as const).map(({ label, icon }) => (
                <button
                  key={label}
                  onClick={() => { toast.info(`${label} — coming soon`); closePanel(); }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  <span className="text-neutral-400 dark:text-neutral-500">{icon}</span>
                  {label}
                  <span className="ml-auto text-[10px] text-neutral-300 dark:text-neutral-600">Soon</span>
                </button>
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
