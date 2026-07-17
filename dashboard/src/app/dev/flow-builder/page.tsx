'use client';

import { useState } from 'react';
import { notFound } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fromFlowJson, toFlowJson, type FlowJson, type FlowScreen } from '@/types/flowBuilder';
import { FlowScreenEditor } from '@/components/flow-builder/FlowScreenEditor';

// Dev-only harness for the Phase 2a Flow screen editor — NOT linked from any
// navigation and 404s in production builds. Local mock state only: it exists so
// the stack render / drag-reorder / toFlowJson round-trip can be verified
// visually before Phase 2b wires real save/publish. Delete or gate further
// when 2b lands a real entry point.

const MOCK_SCREENS: FlowScreen[] = [
  {
    id: 'WELCOME',
    title: 'Welcome',
    terminal: false,
    components: [
      { id: 'seed-w1', type: 'TextHeading', text: 'Open your trading account' },
      { id: 'seed-w2', type: 'TextBody', text: 'Tell us a little about yourself and we will get you started.' },
      { id: 'seed-w3', type: 'TextInput', name: 'full_name', label: 'Full name', inputType: 'text', required: true },
      {
        id: 'seed-w4',
        type: 'Dropdown',
        name: 'product_interest',
        label: 'Product interest',
        required: true,
        dataSource: [
          { id: 'opt-equity', title: 'Equity' },
          { id: 'opt-fno', title: 'Futures & Options' },
          { id: 'opt-mf', title: 'Mutual funds' },
        ],
      },
      { id: 'seed-w5', type: 'Footer', label: 'Continue' },
    ],
  },
  {
    id: 'CONFIRM',
    title: 'Confirm',
    terminal: true,
    components: [
      { id: 'seed-c1', type: 'TextSubheading', text: 'Almost done' },
      { id: 'seed-c2', type: 'DatePicker', name: 'callback_date', label: 'Callback date', required: false },
      { id: 'seed-c3', type: 'OptIn', name: 'consent', label: 'I agree to updates', required: true },
      { id: 'seed-c4', type: 'Footer', label: 'Submit' },
    ],
  },
];

// Recomputed on every edit: serialize → parse → deserialize → re-serialize,
// then compare JSON — the Phase 2a losslessness contract (editor-local ids are
// regenerated on load by design, so equality is defined at the JSON level).
function checkRoundTrip(screens: FlowScreen[]): { pass: boolean; jsonText: string; error?: string } {
  try {
    const json = toFlowJson(screens);
    const jsonText = JSON.stringify(json, null, 2);
    const reparsed = fromFlowJson(JSON.parse(jsonText) as FlowJson);
    const pass = JSON.stringify(toFlowJson(reparsed)) === JSON.stringify(json);
    return { pass, jsonText };
  } catch (err) {
    return { pass: false, jsonText: '', error: err instanceof Error ? err.message : String(err) };
  }
}

export default function FlowBuilderDevPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return <FlowBuilderHarness />;
}

function FlowBuilderHarness() {
  const [screens, setScreens] = useState<FlowScreen[]>(MOCK_SCREENS);
  const [activeIndex, setActiveIndex] = useState(0);
  const roundTrip = checkRoundTrip(screens);

  function handleScreenChange(updated: FlowScreen) {
    setScreens((prev) => prev.map((s, i) => (i === activeIndex ? updated : s)));
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-white">Flow screen editor — dev harness</h1>
        <p className="text-xs text-neutral-400">
          Phase 2a surface only. Local mock state, no API calls; dev builds only.
        </p>
      </div>

      {/* Screen tabs */}
      <div className="flex items-center gap-1.5">
        {screens.map((screen, i) => (
          <button
            key={screen.id}
            type="button"
            onClick={() => setActiveIndex(i)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium',
              i === activeIndex
                ? 'bg-primary-600 text-white'
                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700',
            )}
          >
            {screen.title || screen.id}
            {screen.terminal && ' (terminal)'}
          </button>
        ))}
      </div>

      <FlowScreenEditor screen={screens[activeIndex]} onChange={handleScreenChange} />

      {/* Live round-trip verification */}
      <div
        className={cn(
          'rounded-xl border p-3',
          roundTrip.pass
            ? 'border-success-500/40 bg-success-50 dark:bg-success-900/10'
            : 'border-error-500/40 bg-error-50 dark:bg-error-900/10',
        )}
        data-testid="round-trip-verdict"
        data-pass={roundTrip.pass}
      >
        <div className="flex items-center gap-2">
          {roundTrip.pass ? (
            <CheckCircle2 className="h-4 w-4 text-success-600" aria-hidden />
          ) : (
            <XCircle className="h-4 w-4 text-error-600" aria-hidden />
          )}
          <p className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
            toFlowJson → fromFlowJson → toFlowJson round-trip: {roundTrip.pass ? 'LOSSLESS' : 'FAILED'}
          </p>
        </div>
        {roundTrip.error && <p className="mt-1 text-xs text-error-600">{roundTrip.error}</p>}
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] font-medium text-neutral-500">Generated Flow JSON</summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-neutral-900 p-3 text-[11px] leading-relaxed text-neutral-100">
            {roundTrip.jsonText}
          </pre>
        </details>
      </div>
    </div>
  );
}
