'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, History, FlaskConical } from 'lucide-react';
import { Button } from '@/components/v3/ui/Button';
import { Badge } from '@/components/v3/ui/Badge';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { ApiClientError } from '@/lib/api';
import { TestResultPanel } from '@/components/v3/ai-admin/TestResultPanel';
import {
  aiAdminKeys, fetchPromptAddendum, savePromptAddendumDraft, testPromptAddendum, publishPromptAddendum,
  fetchPromptAddendumVersions, restorePromptAddendumVersion, type TestResult,
} from '@/lib/ai-admin/api';

const MAX_LENGTH = 1000;

export function PromptManagementTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: aiAdminKeys.promptAddendum(), queryFn: fetchPromptAddendum });
  const { data: versionsData } = useQuery({ queryKey: aiAdminKeys.promptAddendumVersions(), queryFn: fetchPromptAddendumVersions });

  const [textOverride, setTextOverride] = useState<string | null>(null);
  const [liveResult, setLiveResult] = useState<TestResult | null>(null);
  const [testedText, setTestedText] = useState<string | null>(null);

  const text = textOverride ?? data?.draftText ?? '';
  const canPublish = liveResult?.allPassed === true && testedText === text;

  const saveMutation = useMutation({
    mutationFn: savePromptAddendumDraft,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: aiAdminKeys.promptAddendum() });
      setTextOverride(null);
      toast.success('Draft saved');
    },
    onError: () => toast.error('Could not save draft — try again.'),
  });

  const testMutation = useMutation({
    mutationFn: () => testPromptAddendum(text),
    onSuccess: (result) => {
      setLiveResult(result);
      setTestedText(text);
      qc.invalidateQueries({ queryKey: aiAdminKeys.promptAddendum() });
      toast[result.allPassed ? 'success' : 'error'](result.allPassed ? 'All compliance checks passed' : 'Compliance test failed — see details below');
    },
    onError: () => toast.error('Test run failed — try again.'),
  });

  const publishMutation = useMutation({
    mutationFn: publishPromptAddendum,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: aiAdminKeys.promptAddendum() });
      qc.invalidateQueries({ queryKey: aiAdminKeys.promptAddendumVersions() });
      setTextOverride(null); setLiveResult(null); setTestedText(null);
      toast.success(`Published as version ${res.version}`);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiClientError && err.status === 422 && err.body?.testResult) {
        setLiveResult(err.body.testResult as TestResult);
        toast.error('Compliance test failed at publish — not published. See details below.');
      } else {
        toast.error('Publish failed — try again.');
      }
    },
  });

  const restoreMutation = useMutation({
    mutationFn: restorePromptAddendumVersion,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: aiAdminKeys.promptAddendum() });
      qc.invalidateQueries({ queryKey: aiAdminKeys.promptAddendumVersions() });
      setTextOverride(null); setLiveResult(null); setTestedText(null);
      toast.success(`Restored — now live as version ${res.version}`);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiClientError && err.status === 422) {
        toast.error('That version no longer passes today\'s compliance rules — not restored.');
      } else {
        toast.error('Restore failed — try again.');
      }
    },
  });

  if (isLoading || !data) {
    return <div className="space-y-3"><Skeleton className="h-64 w-full" /></div>;
  }

  const draftDirty = text !== (data.draftText ?? '');

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-xl border border-primary-200 bg-primary-50 p-4 dark:border-primary-900/40 dark:bg-primary-900/10">
        <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-primary-600 dark:text-primary-400" aria-hidden />
        <p className="text-sm text-primary-900 dark:text-primary-200">
          This addendum is appended after the AI&apos;s permanently code-locked compliance rules — it can never override them.
          Every publish (and every restore) automatically re-runs a real compliance test before it can go live.
        </p>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold text-neutral-900 dark:text-white">
            Prompt addendum {data.activeVersion > 0 && <span className="font-normal text-neutral-400">— live version {data.activeVersion}</span>}
          </p>
          <p className="text-xs text-neutral-500">{text.length}/{MAX_LENGTH}</p>
        </div>
        <textarea
          rows={5}
          maxLength={MAX_LENGTH}
          value={text}
          onChange={(e) => setTextOverride(e.target.value)}
          placeholder="e.g. Always mention our 24hr response time when a customer asks about support."
          disabled={saveMutation.isPending || testMutation.isPending || publishMutation.isPending}
          className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-600 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => saveMutation.mutate(text)} disabled={!draftDirty || saveMutation.isPending}>
            Save Draft
          </Button>
          <Button variant="secondary" iconLeft={<FlaskConical className="h-4 w-4" />} onClick={() => testMutation.mutate()} disabled={testMutation.isPending || !text.trim()}>
            {testMutation.isPending ? 'Running test…' : 'Run Test'}
          </Button>
          <Button onClick={() => publishMutation.mutate()} disabled={!canPublish || publishMutation.isPending}>
            {publishMutation.isPending ? 'Publishing…' : 'Publish'}
          </Button>
          {!canPublish && text.trim() && (
            <span className="flex items-center gap-1 text-xs text-neutral-500">
              <AlertTriangle className="h-3.5 w-3.5" /> Run a passing test against this exact text before publishing.
            </span>
          )}
        </div>

        {liveResult && <TestResultPanel result={liveResult} />}
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <p className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:border-neutral-800">
          <History className="h-3.5 w-3.5" /> Version history
        </p>
        {!versionsData?.versions.length ? (
          <p className="px-4 py-6 text-center text-sm text-neutral-400">No published versions yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {versionsData.versions.map((v) => (
              <li key={v.version} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                    Version {v.version} {v.version === data.activeVersion && <Badge variant="primary">Live</Badge>}
                    {v.restoredFrom != null && <span className="ml-2 text-xs font-normal text-neutral-400">restored from v{v.restoredFrom}</span>}
                  </p>
                  <p className="mt-0.5 max-w-md truncate text-xs text-neutral-500">{v.text || '(empty)'}</p>
                  <p className="mt-0.5 text-xs text-neutral-400">{new Date(v.publishedAt).toLocaleString()}</p>
                </div>
                {v.version !== data.activeVersion && (
                  <Button
                    size="sm" variant="secondary"
                    onClick={() => restoreMutation.mutate(v.version)}
                    disabled={restoreMutation.isPending}
                  >
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
