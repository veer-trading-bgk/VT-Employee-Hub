'use client';

import { useEffect, useCallback, useState } from 'react';
import { Users, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/api';
import { STAGE_LABELS, type Stage } from '@/types/v3';
import type { AudienceFilter, AudiencePreviewResponse } from '@/types/campaigns';

const STAGE_OPTIONS: Stage[] = [
  'new_lead', 'contacted', 'interested', 'kyc_done', 'demat_done', 'lost',
];

const SOURCE_OPTIONS = [
  { value: 'form',     label: 'Form'     },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'import',   label: 'Import'   },
  { value: 'ctwa',     label: 'CTWA'     },
  { value: 'manual',   label: 'Manual'   },
  { value: 'api',      label: 'API'      },
];

interface AudienceBuilderProps {
  value:    AudienceFilter;
  onChange: (filter: AudienceFilter) => void;
}

export function AudienceBuilder({ value, onChange }: AudienceBuilderProps) {
  const [count,   setCount]   = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [exceeds, setExceeds] = useState(false);

  const { data: tagsData } = useQuery<{ success: boolean; tags: Array<{ id: string; label: string; color: string }> }>({
    queryKey: ['tag-catalog'],
    queryFn:  () => apiFetch('/api/tags'),
    staleTime: 5 * 60 * 1000,
  });
  // tags endpoint returns objects; extract labels so allTags stays string[]
  const allTags = (tagsData?.tags ?? []).map((t) => t.label);

  const fetchPreview = useCallback(async (filter: AudienceFilter) => {
    setLoading(true);
    try {
      const res = await apiFetch<AudiencePreviewResponse>('/api/campaigns/audience/preview', {
        method: 'POST',
        body:   JSON.stringify({ filter }),
      });
      setCount(res.count);
      setExceeds(res.exceedsLimit);
    } catch {
      setCount(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => fetchPreview(value), 700);
    return () => clearTimeout(t);
  }, [value, fetchPreview]);

  function toggleStage(stage: Stage) {
    const stages = value.stages ?? [];
    onChange({
      ...value,
      stages: stages.includes(stage)
        ? stages.filter((s) => s !== stage)
        : [...stages, stage],
    });
  }

  function toggleTag(tag: string) {
    const tags = value.tags ?? [];
    onChange({
      ...value,
      tags: tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag],
    });
  }

  return (
    <div className="space-y-5">
      {/* Live count */}
      <div className={cn(
        'flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium',
        exceeds
          ? 'border-warning-200 bg-warning-50 text-warning-700 dark:border-warning-800 dark:bg-warning-900/20 dark:text-warning-400'
          : 'border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-800 dark:bg-primary-900/20 dark:text-primary-400',
      )}>
        {loading
          ? <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          : <Users className="h-4 w-4 shrink-0" />}
        <span>
          {loading
            ? 'Counting audience…'
            : count === null
            ? 'Set filters below to preview audience size'
            : exceeds
            ? `${count.toLocaleString()} contacts — exceeds 1,000 limit. Refine your filters.`
            : `${count.toLocaleString()} contact${count !== 1 ? 's' : ''} will receive this campaign`}
        </span>
      </div>

      {/* Pipeline stage multi-select */}
      <div>
        <p className="mb-1 text-sm font-medium text-neutral-700 dark:text-neutral-300">Pipeline Stage</p>
        <p className="mb-3 text-xs text-neutral-400">Leave all unchecked to include every stage.</p>
        <div className="grid grid-cols-2 gap-2">
          {STAGE_OPTIONS.map((stage) => {
            const on = (value.stages ?? []).includes(stage);
            return (
              <button
                key={stage}
                type="button"
                onClick={() => toggleStage(stage)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                  on
                    ? 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
                    : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-750',
                )}
              >
                <span className={cn(
                  'h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 text-[10px] font-bold',
                  on ? 'border-primary-500 bg-primary-500 text-white' : 'border-neutral-300 dark:border-neutral-600',
                )}>
                  {on ? '✓' : ''}
                </span>
                {STAGE_LABELS[stage]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tag filter */}
      {allTags.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">Tags</p>
          <div className="flex flex-wrap gap-2">
            {allTags.map((tag) => {
              const on = (value.tags ?? []).includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    on
                      ? 'border-primary-400 bg-primary-100 text-primary-700 dark:border-primary-600 dark:bg-primary-900/30 dark:text-primary-300'
                      : 'border-neutral-200 bg-neutral-50 text-neutral-600 hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400',
                  )}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Source filter */}
      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Lead Source
        </label>
        <select
          value={value.source ?? ''}
          onChange={(e) => onChange({ ...value, source: e.target.value || undefined })}
          className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        >
          <option value="">All sources</option>
          {SOURCE_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
