'use client';

import { useState } from 'react';
import { inferJourney } from '@/lib/contacts/journeyInference';
import type { ContactDetail } from '@/lib/contacts/types';
import type { PipelineStage } from '@/hooks/usePipelineStages';

type ContactForJourney = Pick<ContactDetail, 'stage' | 'createdAt' | 'messageCount' | 'milestones'>;

function fmtDate(iso?: string): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  });
}

interface CustomerJourneyBarProps {
  contact: ContactForJourney;
  stages: PipelineStage[];
}

/**
 * Ported 2026-07-09 from the orphaned ContactHeader.tsx (docs/phase3/
 * TECHNICAL_DEBT.md) into the live Customer 360 header
 * (app/(v3)/contacts/[contactId]/page.tsx) — real, documented functionality
 * (docs/v3/08_CUSTOMER360_VISION.md's header mockup shows this exact
 * 8-step bar) that had zero importers anywhere. Recolored from the
 * orphaned file's slate-* palette to neutral-*, matching the live page's
 * actual current convention (docs/v3/10_DESIGN_SYSTEM.md documents slate-*
 * as canonical, but the shipped V3 page uses neutral-* throughout — matching
 * the page this component now actually lives in, not the stale doc).
 */
export function CustomerJourneyBar({ contact, stages }: CustomerJourneyBarProps) {
  const steps = inferJourney(contact, stages);
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
                  'flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1',
                  step.state === 'complete'
                    ? 'border-primary-600 bg-primary-600 dark:border-primary-400 dark:bg-primary-400'
                    : step.state === 'active'
                    ? 'border-primary-600 bg-white dark:border-primary-400 dark:bg-neutral-900'
                    : 'border-neutral-300 bg-white dark:border-neutral-600 dark:bg-neutral-900',
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
                    className="h-2 w-2 rounded-full bg-primary-600 dark:bg-primary-400"
                    aria-hidden="true"
                  />
                )}
              </button>

              <span
                className={[
                  'mt-0.5 whitespace-nowrap text-[9px] font-medium leading-tight',
                  step.state === 'future'
                    ? 'text-neutral-400 dark:text-neutral-600'
                    : 'text-neutral-600 dark:text-neutral-300',
                ].join(' ')}
              >
                {step.label}
              </span>

              {/* Tooltip */}
              {tooltip === i && (
                <div
                  role="tooltip"
                  className="absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-neutral-900 px-2.5 py-1.5 text-[10px] leading-snug text-white shadow-lg dark:bg-neutral-700"
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
                    ? 'bg-primary-300 dark:bg-primary-700'
                    : 'bg-neutral-200 dark:bg-neutral-700',
                ].join(' ')}
              />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
