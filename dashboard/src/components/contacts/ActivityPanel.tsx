'use client';

import { useCustomer360 } from '@/contexts/Customer360Context';
import type { ContactDetail } from '@/lib/contacts/types';

const STATUS_STYLES: Record<string, string> = {
  open:       'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  unassigned: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  resolved:   'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

function derivePriority(contact: ContactDetail): 'hot' | 'warm' | 'cold' {
  if (contact.closureDeadline) {
    const daysLeft = Math.ceil(
      (new Date(contact.closureDeadline).getTime() - Date.now()) / 86_400_000
    );
    if (daysLeft >= 0 && daysLeft <= 7) return 'hot';
  }
  if (!contact.lastInboundAt) return 'cold';
  const daysSince = (Date.now() - new Date(contact.lastInboundAt).getTime()) / 86_400_000;
  if (daysSince < 1) return 'hot';
  if (daysSince < 7) return 'warm';
  return 'cold';
}

const PRIORITY_STYLES = {
  hot:  { label: 'Hot',  cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  warm: { label: 'Warm', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  cold: { label: 'Cold', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
} as const;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata',
  });
}

interface ActivityPanelProps {
  className?: string;
}

export function ActivityPanel({ className = '' }: ActivityPanelProps) {
  const { contact, stageObj, timeline, nextFollowup } = useCustomer360();

  if (!contact) return null;

  const chatStatus = contact.chatStatus ?? 'open';
  const recentActivity = [...timeline].reverse().slice(0, 3);
  const priority = derivePriority(contact);
  const priorityStyle = PRIORITY_STYLES[priority];

  function copyPhone() {
    navigator.clipboard.writeText(contact!.phone).catch(() => {});
  }

  const waPhone = contact.phone.replace(/\D/g, '');

  return (
    <aside
      role="complementary"
      aria-label="Contact activity panel"
      className={`flex-col overflow-y-auto border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 ${className}`}
    >
      <div className="space-y-5 p-4">

        {/* ── Assigned Employee ───────────────────────────── */}
        <section aria-labelledby="panel-assigned">
          <h3 id="panel-assigned" className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Assigned To
          </h3>
          <div className="flex items-center gap-2">
            <div
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-500 text-xs font-bold text-white"
              aria-hidden="true"
            >
              {contact.assignedToName?.[0]?.toUpperCase() ?? '?'}
            </div>
            <span className="text-sm text-slate-700 dark:text-slate-300">
              {contact.assignedToName ?? 'Unassigned'}
            </span>
          </div>
        </section>

        {/* ── Conversation Status ─────────────────────────── */}
        <section aria-labelledby="panel-status">
          <h3 id="panel-status" className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Status
          </h3>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${STATUS_STYLES[chatStatus] ?? STATUS_STYLES.open}`}>
            {chatStatus}
          </span>
        </section>

        {/* ── Priority ────────────────────────────────────── */}
        <section aria-labelledby="panel-priority">
          <h3 id="panel-priority" className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Priority
          </h3>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${priorityStyle.cls}`}>
            {priorityStyle.label}
          </span>
        </section>

        {/* ── AI Health Score ─────────────────────────────── */}
        <section aria-labelledby="panel-health" data-slot="activity-panel-ai-health">
          <h3 id="panel-health" className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Health Score
          </h3>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-400 dark:bg-slate-800 dark:text-slate-500">
              — / 100
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500">AI not enabled</span>
          </div>
        </section>

        {/* ── Lead Stage ──────────────────────────────────── */}
        <section aria-labelledby="panel-stage">
          <h3 id="panel-stage" className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Stage
          </h3>
          {stageObj ? (
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-white"
              style={{ backgroundColor: stageObj.color }}
            >
              {stageObj.label}
            </span>
          ) : (
            <span className="text-sm text-slate-400">—</span>
          )}
        </section>

        {/* ── Close Deadline (Next Follow-up placeholder) ─── */}
        <section aria-labelledby="panel-deadline">
          <h3 id="panel-deadline" className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Close Deadline
          </h3>
          {contact.closureDeadline ? (
            <p className="text-sm text-slate-700 dark:text-slate-300">
              {new Date(contact.closureDeadline).toLocaleDateString('en-IN', {
                day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
              })}
            </p>
          ) : (
            <p className="text-xs text-slate-400">No deadline set</p>
          )}
          <div data-slot="activity-panel-tasks" className="hidden" aria-hidden="true" />
        </section>

        {/* ── Next Follow-up ───────────────────────────────── */}
        <section aria-labelledby="panel-followup">
          <h3 id="panel-followup" className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Next Follow-up
          </h3>
          {nextFollowup ? (
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {fmtDate(nextFollowup.date)}
              </p>
              {nextFollowup.note && (
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {nextFollowup.note}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-400">None scheduled</p>
          )}
        </section>

        {/* ── Tags ────────────────────────────────────────── */}
        {contact.tags && contact.tags.length > 0 && (
          <section aria-labelledby="panel-tags">
            <h3 id="panel-tags" className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Tags
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {contact.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                >
                  {tag}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* ── Recent Activity ──────────────────────────────── */}
        {recentActivity.length > 0 && (
          <section aria-labelledby="panel-recent">
            <h3 id="panel-recent" className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Recent Activity
            </h3>
            <ul className="space-y-2">
              {recentActivity.map((item) => (
                <li key={item.SK} className="flex items-start gap-2">
                  <span className="mt-0.5 flex-shrink-0 text-[10px]" aria-hidden="true">
                    {item._kind === 'note' ? '🔒' : item.direction === 'inbound' ? '📩' : '📤'}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs text-slate-600 dark:text-slate-400">
                      {item.content.length > 45 ? `${item.content.slice(0, 45)}…` : item.content}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {new Date(item.timestamp).toLocaleTimeString('en-IN', {
                        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
                      })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Quick Actions ────────────────────────────────── */}
        <section aria-labelledby="panel-actions">
          <h3 id="panel-actions" className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Quick Actions
          </h3>
          <div className="space-y-1.5">
            <a
              href={`https://wa.me/${waPhone}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <span aria-hidden="true">📱</span> Open in WhatsApp
            </a>
            <button
              onClick={copyPhone}
              className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <span aria-hidden="true">📋</span> Copy Phone
            </button>
          </div>
        </section>

        {/* ── Reserved extension slots ─────────────────────── */}
        <div data-slot="activity-panel-ai"       className="hidden" aria-hidden="true" />
        <div data-slot="activity-panel-workflow"  className="hidden" aria-hidden="true" />
        <div data-slot="activity-panel-sla"       className="hidden" aria-hidden="true" />
        <div data-slot="activity-panel-files"     className="hidden" aria-hidden="true" />

      </div>
    </aside>
  );
}
