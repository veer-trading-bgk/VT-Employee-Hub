'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import { Badge } from '@/components/v3/ui/Badge';
import type { TestResult } from '@/lib/ai-admin/api';

// Shared between Prompt Management (PromptManagementTab) and the Structured
// Knowledge Center (KnowledgeEntryDrawer) — both gate publish behind the same
// PromptTestService shape ({ allPassed, results, testedAt }), so this itemized
// pass/fail/known-issue view is intentionally one component, not two drifting
// copies.
export function TestResultPanel({ result }: { result: TestResult }) {
  return (
    <div className="mt-3 rounded-lg border border-neutral-200 dark:border-neutral-800">
      <div className={`flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-semibold ${
        result.allPassed
          ? 'bg-success-50 text-success-700 dark:bg-success-900/20 dark:text-success-300'
          : 'bg-error-50 text-error-700 dark:bg-error-900/20 dark:text-error-300'
      }`}
      >
        {result.allPassed ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
        {result.allPassed
          ? (result.results.some((r) => r.knownIssue)
            ? 'All checks passed (1 known, non-blocking issue below)'
            : 'All checks passed')
          : `${result.results.filter((r) => !r.passed && !r.knownIssue).length} of ${result.results.length} checks failed`}
      </div>
      <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {result.results.map((r, i) => (
          <li key={i} className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-neutral-700 dark:text-neutral-300">&ldquo;{r.input}&rdquo;</p>
              <Badge variant={r.passed ? 'success' : r.knownIssue ? 'warning' : 'error'}>
                {r.passed ? 'Pass' : r.knownIssue ? 'Known issue' : 'Fail'}
              </Badge>
            </div>
            {!r.passed && r.knownIssue && (
              <div className="mt-1.5 space-y-1.5 rounded bg-amber-50 p-2 dark:bg-amber-900/10">
                <p className="text-xs text-amber-800 dark:text-amber-300">{r.knownIssue}</p>
                {r.reply && <p className="text-xs text-neutral-600 dark:text-neutral-400">Reply: &ldquo;{r.reply}&rdquo;</p>}
              </div>
            )}
            {!r.passed && !r.knownIssue && (
              <p className="mt-1.5 rounded bg-error-50 p-2 text-xs text-error-700 dark:bg-error-900/10 dark:text-error-300">
                {r.reply ? <>Reply: &ldquo;{r.reply}&rdquo;</> : r.reason}
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="border-t border-neutral-100 px-4 py-2 text-xs text-neutral-400 dark:border-neutral-800">
        Tested {new Date(result.testedAt).toLocaleString()} — single-pass against today&apos;s model, not a permanent guarantee.
      </p>
    </div>
  );
}
