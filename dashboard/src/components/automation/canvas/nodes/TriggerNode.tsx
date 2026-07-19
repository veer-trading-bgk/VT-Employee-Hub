'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useQuery } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/api';
import type { CanvasNode } from '@/lib/automationGraph';
import type { CommentReceivedTriggerConfig } from '@/types/automations';

interface IgMediaRecord {
  id:      string;
  caption?: string;
}

// comment_received-only detail line: which post + keyword this trigger
// targets. Resolves mediaId -> caption via the same GET /api/instagram/media
// call the trigger's own picker uses (['instagram-media'] cache — a hit, not
// a new fetch, whenever the trigger panel has already loaded), same pattern
// SendFlowNode.tsx uses to resolve flowId -> Flow name. Every other trigger
// type shows only its generic type label, unchanged.
function CommentReceivedDetail({ config }: { config: CommentReceivedTriggerConfig }) {
  const { data } = useQuery({
    queryKey: ['instagram-media'],
    queryFn:  () => apiFetch<{ media: IgMediaRecord[] }>('/api/instagram/media'),
    staleTime: 60_000,
  });
  const post = data?.media.find((m) => m.id === config?.mediaId);
  const postLabel = post?.caption?.slice(0, 40) || (config?.mediaId ? 'Unknown post' : 'No post selected');
  const keyword = (config?.keywords ?? []).filter((k) => k.trim()).join(', ') || 'no keyword set';

  return (
    <p className="mt-1 truncate text-[11px] text-primary-700/80 dark:text-primary-400/80">
      {postLabel} · &ldquo;{keyword}&rdquo;
    </p>
  );
}

export function TriggerNode({ data, selected }: NodeProps<CanvasNode>) {
  return (
    <div className={cn(
      'w-56 rounded-xl border-2 bg-primary-50 px-4 py-3 shadow-sm dark:bg-primary-900/20',
      selected ? 'border-primary-500' : 'border-primary-300 dark:border-primary-700',
    )}>
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-100 dark:bg-primary-900/40">
          <Zap className="h-3.5 w-3.5 text-primary-600 dark:text-primary-400" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-400">Trigger</p>
          <p className="truncate text-sm font-medium text-neutral-900 dark:text-white">{data.label ?? 'Trigger'}</p>
        </div>
      </div>
      {data.triggerType === 'comment_received' && (
        <CommentReceivedDetail config={data.triggerConfig as CommentReceivedTriggerConfig} />
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-primary-400" />
    </div>
  );
}
