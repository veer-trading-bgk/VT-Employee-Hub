'use client';

import { useState } from 'react';
import { inferJourney } from '@/lib/contacts/journeyInference';
import type { ContactDetail } from '@/lib/contacts/types';

type ContactForJourney = Pick<ContactDetail, 'stage' | 'createdAt' | 'messageCount' | 'milestones'>;

function fmtDate(iso?: string): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  });
}

interface CustomerJourneyBarProps {
  contact: ContactForJourney;
}

export function CustomerJourneyBar({ contact }: CustomerJourneyBarProps) {
  const steps = inferJourney(contact);
  const [tooltip, setTooltip] = useState<number | null>(null);

  return (
    <nav aria-label="Customer journey" className="overflow-x-auto scrollbar-none">
      <ol className="flex items-end gap-0">
        {steps.map((step, i) => (
          <li key={step.id} className="flex flex-shrink-0 items-center">
            {/* Step indicator */}
            <div className="relative flex flex-col items-center">
              <button
                type="button"
                onMouseEnter={() => setTooltip(i)}
                onMouseLeave={() => setTooltip(null)}
                onFocus={() => setTooltip(i)}
                onBlur={() => setTooltip(null)}
                aria-label={`${step.label}: ${step.state}`}
                className={[
                  'flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1',
                  step.state === 'complete'
                    ? 'border-indigo-500 bg-indigo-500 dark:border-indigo-400 dark:bg-indigo-400'
                    : step.state === 'active'
                    ? 'border-indigo-500 bg-white dark:border-indigo-400 dark:bg-slate-900'
                    : 'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900',
                ].join(' ')}
              >
                {step.state === 'complete' && (
                  <svg
                    className="h-2.5 w-2.5 text-white"
                    viewBox="0 0 10 8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M1 4l3 3 5-6" />
                  </svg>
                )}
                {step.state === 'active' && (
                  <span
                    className="h-2 w-2 rounded-full bg-indigo-500 dark:bg-indigo-400"
                    aria-hidden="true"
                  />
                )}
              </button>

              <span
                className={[
                  'mt-0.5 whitespace-nowrap text-[9px] font-medium leading-tight',
                  step.state === 'future'
                    ? 'text-slate-400 dark:text-slate-600'
                    : 'text-slate-600 dark:text-slate-300',
                ].join(' ')}
              >
                {step.label}
              </span>

              {/* Tooltip */}
              {tooltip === i && (
                <div
                  role="tooltip"
                  className="absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-[10px] leading-snug text-white shadow-lg dark:bg-slate-700"
                >
                  <strong>{step.label}</strong>
                  {step.date && (
                    <> · {fmtDate(step.date)}</>
                  )}
                  {!step.date && step.state === 'active' && <> · In progress</>}
                  {!step.date && step.state === 'complete' && <> · Completed</>}
                  {step.state === 'future' && <> · Not reached</>}
                </div>
              )}
            </div>

            {/* Connector line between steps */}
            {i < steps.length - 1 && (
              <div
                aria-hidden="true"
                className={[
                  'mb-4 h-[2px] w-3 flex-shrink-0 sm:w-4',
                  steps[i].state !== 'future' && steps[i + 1].state !== 'future'
                    ? 'bg-indigo-300 dark:bg-indigo-700'
                    : 'bg-slate-200 dark:bg-slate-700',
                ].join(' ')}
              />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
