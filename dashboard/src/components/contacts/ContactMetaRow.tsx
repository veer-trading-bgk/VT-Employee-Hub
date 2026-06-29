'use client';

import type { ContactDetail } from '@/lib/contacts/types';

interface PipelineStage {
  key: string;
  label: string;
  color: string;
}

function timeAgo(iso?: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata',
  });
}

const CHAT_STATUS_STYLE: Record<string, string> = {
  open:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  unassigned:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  resolved:
    'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

interface ContactMetaRowProps {
  contact: Pick<ContactDetail, 'stage' | 'assignedToName' | 'chatStatus' | 'lastInboundAt' | 'updatedAt'>;
  stages: PipelineStage[];
}

export function ContactMetaRow({ contact, stages }: ContactMetaRowProps) {
  const stageObj = stages.find((s) => s.key === contact.stage);
  const lastActivity = contact.lastInboundAt ?? contact.updatedAt;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
      {/* Stage badge */}
      {contact.stage && (
        <span
          className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold"
          style={
            stageObj
              ? {
                  borderColor: stageObj.color + '80',
                  color: stageObj.color,
                  backgroundColor: stageObj.color + '18',
                }
              : { borderColor: '#e2e8f0', color: '#64748b', backgroundColor: '#f8fafc' }
          }
          aria-label={`Stage: ${stageObj?.label ?? contact.stage}`}
        >
          {stageObj?.label ?? contact.stage}
        </span>
      )}

      {/* Chat status chip */}
      {contact.chatStatus && (
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${CHAT_STATUS_STYLE[contact.chatStatus] ?? ''}`}
          aria-label={`Chat status: ${contact.chatStatus}`}
        >
          {contact.chatStatus.charAt(0).toUpperCase() + contact.chatStatus.slice(1)}
        </span>
      )}

      {/* Assigned agent */}
      <span className="text-slate-500 dark:text-slate-400">
        {contact.assignedToName ? (
          <>
            Assigned to{' '}
            <strong className="font-medium text-slate-700 dark:text-slate-200">
              {contact.assignedToName}
            </strong>
          </>
        ) : (
          <span className="italic">Unassigned</span>
        )}
      </span>

      {/* Last activity */}
      <span className="text-slate-400 dark:text-slate-500" aria-label={`Last activity: ${timeAgo(lastActivity)}`}>
        · {timeAgo(lastActivity)}
      </span>
    </div>
  );
}
