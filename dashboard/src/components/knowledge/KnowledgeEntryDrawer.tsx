'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, FlaskConical, History, Archive, ArchiveRestore } from 'lucide-react';
import { Drawer } from '@/components/v3/ui/Drawer';
import { Button } from '@/components/v3/ui/Button';
import { Input } from '@/components/v3/ui/Input';
import { Badge } from '@/components/v3/ui/Badge';
import { ApiClientError } from '@/lib/api';
import { TestResultPanel } from '@/components/v3/ai-admin/TestResultPanel';
import type { TestResult } from '@/lib/ai-admin/api';
import {
  knowledgeKeys, fetchKnowledgeEntryVersions, createKnowledgeEntry, saveKnowledgeEntryDraft,
  testKnowledgeEntry, publishKnowledgeEntry, restoreKnowledgeEntryVersion,
  archiveKnowledgeEntry, unarchiveKnowledgeEntry, type KnowledgeEntry,
} from '@/lib/knowledge/api';

const ANSWER_MAX_LENGTH = 500;

function parseTriggers(text: string): string[] {
  return text.split(',').map((t) => t.trim()).filter(Boolean);
}

interface Props {
  open: boolean;
  onClose: () => void;
  entry: KnowledgeEntry | null; // null = create mode
}

export function KnowledgeEntryDrawer({ open, onClose, entry }: Props) {
  const qc = useQueryClient();
  const isCreate = entry === null;

  const [overrides, setOverrides] = useState<{ question?: string; triggersText?: string; answer?: string; category?: string }>({});
  const [liveResult, setLiveResult] = useState<TestResult | null>(null);
  const [testedSnapshot, setTestedSnapshot] = useState<string | null>(null);

  const question = overrides.question ?? entry?.draftQuestion ?? '';
  const triggersText = overrides.triggersText ?? (entry?.draftTriggers.join(', ') ?? '');
  const answer = overrides.answer ?? entry?.draftAnswer ?? '';
  const category = overrides.category ?? entry?.category ?? '';
  const triggers = parseTriggers(triggersText);
  const currentSnapshot = JSON.stringify({ question, triggers, answer });
  const canPublish = liveResult?.allPassed === true && testedSnapshot === currentSnapshot;

  const { data: versionsData } = useQuery({
    queryKey: entry ? knowledgeKeys.versions(entry.entryId) : ['knowledge', 'versions', 'none'],
    queryFn: () => fetchKnowledgeEntryVersions(entry!.entryId),
    enabled: open && !isCreate,
  });

  function resetAndClose() {
    setOverrides({}); setLiveResult(null); setTestedSnapshot(null);
    onClose();
  }

  const createMutation = useMutation({
    mutationFn: createKnowledgeEntry,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: knowledgeKeys.list() });
      toast.success('Draft created — open it again to test and publish.');
      resetAndClose();
    },
    onError: () => toast.error('Could not create entry — try again.'),
  });

  const saveDraftMutation = useMutation({
    mutationFn: saveKnowledgeEntryDraft,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: knowledgeKeys.list() });
      toast.success('Draft saved');
    },
    onError: () => toast.error('Could not save draft — try again.'),
  });

  const testMutation = useMutation({
    mutationFn: () => testKnowledgeEntry(entry!.entryId),
    onSuccess: (result) => {
      setLiveResult(result); setTestedSnapshot(currentSnapshot);
      qc.invalidateQueries({ queryKey: knowledgeKeys.list() });
      toast[result.allPassed ? 'success' : 'error'](result.allPassed ? 'All compliance checks passed' : 'Compliance test failed — see details below');
    },
    onError: () => toast.error('Test run failed — try again.'),
  });

  const publishMutation = useMutation({
    mutationFn: () => publishKnowledgeEntry(entry!.entryId),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: knowledgeKeys.list() });
      qc.invalidateQueries({ queryKey: knowledgeKeys.versions(entry!.entryId) });
      setOverrides({}); setLiveResult(null); setTestedSnapshot(null);
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
    mutationFn: (version: number) => restoreKnowledgeEntryVersion({ entryId: entry!.entryId, version }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: knowledgeKeys.list() });
      qc.invalidateQueries({ queryKey: knowledgeKeys.versions(entry!.entryId) });
      setOverrides({}); setLiveResult(null); setTestedSnapshot(null);
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

  const archiveMutation = useMutation({
    mutationFn: () => (entry!.archived ? unarchiveKnowledgeEntry(entry!.entryId) : archiveKnowledgeEntry(entry!.entryId)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: knowledgeKeys.list() });
      toast.success(entry!.archived ? 'Entry unarchived — live matching resumes' : 'Entry archived — excluded from live matching');
    },
    onError: () => toast.error('Action failed — try again.'),
  });

  const draftDirty = isCreate
    ? Boolean(question || triggersText || answer)
    : (question !== entry!.draftQuestion || triggersText !== entry!.draftTriggers.join(', ') || answer !== entry!.draftAnswer || category !== (entry!.category ?? ''));
  const canSubmit = question.trim() && triggers.length > 0 && answer.trim();

  return (
    <Drawer
      open={open}
      onClose={resetAndClose}
      title={isCreate ? 'New knowledge entry' : 'Edit knowledge entry'}
      description="Matched by keyword against the customer's message — the HARD COMPLIANCE RULES always take precedence over this answer."
      width={480}
    >
      <div className="space-y-4">
        {!isCreate && (
          <div className="flex items-center gap-2">
            {entry!.archived
              ? <Badge variant="default">Archived</Badge>
              : entry!.activeVersion > 0
                ? <Badge variant="primary">Live — version {entry!.activeVersion}</Badge>
                : <Badge variant="warning">Draft — never published</Badge>}
          </div>
        )}

        <Input
          label="Question" required
          value={question}
          onChange={(e) => setOverrides((o) => ({ ...o, question: e.target.value }))}
          placeholder="What are your account opening fees?"
          maxLength={200}
        />
        <Input
          label="Trigger keywords (comma-separated)" required
          value={triggersText}
          onChange={(e) => setOverrides((o) => ({ ...o, triggersText: e.target.value }))}
          placeholder="fees, charges, account opening cost"
          hint="Matched case-insensitively as a substring of the customer's message."
        />
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">Answer</label>
            <span className="text-xs text-neutral-500">{answer.length}/{ANSWER_MAX_LENGTH}</span>
          </div>
          <textarea
            rows={4}
            maxLength={ANSWER_MAX_LENGTH}
            value={answer}
            onChange={(e) => setOverrides((o) => ({ ...o, answer: e.target.value }))}
            placeholder="There is no account opening fee; AMC is waived for the first year."
            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </div>
        <Input
          label="Category (optional)"
          value={category}
          onChange={(e) => setOverrides((o) => ({ ...o, category: e.target.value }))}
          placeholder="Fees & Charges"
          maxLength={40}
          hint="Display/filter label only — never sent to the AI."
        />

        {isCreate ? (
          <Button
            className="w-full"
            disabled={!canSubmit || createMutation.isPending}
            onClick={() => createMutation.mutate({ question, triggers, answer, category: category || undefined })}
          >
            {createMutation.isPending ? 'Creating…' : 'Create draft'}
          </Button>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                disabled={!draftDirty || saveDraftMutation.isPending}
                onClick={() => saveDraftMutation.mutate({ entryId: entry!.entryId, question, triggers, answer, category: category || undefined })}
              >
                Save draft
              </Button>
              <Button
                variant="secondary" iconLeft={<FlaskConical className="h-4 w-4" />}
                disabled={!canSubmit || testMutation.isPending}
                onClick={() => testMutation.mutate()}
              >
                {testMutation.isPending ? 'Running test…' : 'Run test'}
              </Button>
              <Button
                disabled={!canPublish || publishMutation.isPending}
                onClick={() => publishMutation.mutate()}
              >
                {publishMutation.isPending ? 'Publishing…' : 'Publish'}
              </Button>
              <Button
                variant="secondary" iconLeft={entry!.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                disabled={archiveMutation.isPending}
                onClick={() => archiveMutation.mutate()}
              >
                {entry!.archived ? 'Unarchive' : 'Archive'}
              </Button>
            </div>
            {!canPublish && canSubmit && (
              <p className="flex items-center gap-1 text-xs text-neutral-500">
                <AlertTriangle className="h-3.5 w-3.5" /> Run a passing test against this exact question/triggers/answer before publishing.
              </p>
            )}

            {liveResult && <TestResultPanel result={liveResult} />}

            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800">
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
                          Version {v.version} {v.version === entry!.activeVersion && <Badge variant="primary">Live</Badge>}
                          {v.restoredFrom != null && <span className="ml-2 text-xs font-normal text-neutral-400">restored from v{v.restoredFrom}</span>}
                        </p>
                        <p className="mt-0.5 max-w-xs truncate text-xs text-neutral-500">{v.question}</p>
                        <p className="mt-0.5 text-xs text-neutral-400">{new Date(v.publishedAt).toLocaleString()}</p>
                      </div>
                      {v.version !== entry!.activeVersion && (
                        <Button size="sm" variant="secondary" disabled={restoreMutation.isPending} onClick={() => restoreMutation.mutate(v.version)}>
                          Restore
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}
