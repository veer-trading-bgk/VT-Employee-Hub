'use client';

/**
 * Active-journey multi-screen form (Phase 3 Task 2 + Task 3).
 * Reuses v3 Input/Select/Button (auth-free — only import @/lib/cn).
 * Step navigation mirrors onboarding's step index + Back/Continue pattern.
 * Collected values are a flat Record<fieldId, string>; submit-ready payload
 * wraps as { journeyRecord, submittedData } — keys create_journey_record reads
 * (AutomationEngine.js: ctx.journeyRecord ?? ctx.submittedData).
 * Final Submit POSTs Task 8's webhook-resume route (Option A) — not /submit.
 */

import { useMemo, useState } from 'react';
import { Input } from '@/components/v3/ui/Input';
import { Select } from '@/components/v3/ui/Select';
import { Button } from '@/components/v3/ui/Button';
import { ErrorState } from '@/components/v3/ui/ErrorState';

export interface JourneyScreenField {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
}

export interface JourneyScreen {
  id: string;
  title: string;
  fields: JourneyScreenField[];
}

/** Shape create_journey_record / resumeOnWebhook expect on the context merge. */
export interface JourneySubmitPayload {
  journeyRecord: Record<string, string>;
  submittedData: Record<string, string>;
}

const FIELD_TYPES = new Set(['text', 'select', 'phone', 'date', 'email']);

function inputTypeFor(type: string): string {
  if (type === 'email') return 'email';
  if (type === 'date') return 'date';
  if (type === 'phone') return 'tel';
  return 'text';
}

function isFilled(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

function ScreenStepBar({
  screens,
  step,
  accent,
}: {
  screens: JourneyScreen[];
  step: number;
  accent: string | null;
}) {
  if (screens.length <= 1) return null;
  return (
    <div className="mb-6 flex items-center gap-0" data-testid="journey-step-bar">
      {screens.map((s, i) => (
        <div key={s.id} className="flex flex-1 flex-col items-center">
          <div
            className={`h-1 w-full transition-all duration-300 ${
              i === 0 ? 'rounded-l-full' : ''
            } ${i === screens.length - 1 ? 'rounded-r-full' : ''}`}
            style={{
              backgroundColor:
                i < step
                  ? (accent ?? '#4f46e5')
                  : i === step
                    ? (accent ? `${accent}99` : '#a5b4fc')
                    : '#e2e8f0',
            }}
          />
          <span
            className={`mt-2 max-w-full truncate px-0.5 text-center text-[10px] font-semibold ${
              i <= step ? 'text-slate-700' : 'text-slate-400'
            }`}
          >
            {s.title || `Step ${i + 1}`}
          </span>
        </div>
      ))}
    </div>
  );
}

export function JourneyActiveForm({
  name,
  screens,
  accent,
  companyId,
  journeyInstanceId,
  token,
  apiBase,
  onInvalid,
}: {
  name: string | null;
  screens: JourneyScreen[];
  accent: string | null;
  companyId: string;
  journeyInstanceId: string;
  token: string;
  apiBase: string;
  /** Non-200 webhook → reuse Task 1 invalid shell (flat 404 from Task 8). */
  onInvalid: () => void;
}) {
  const safeScreens = useMemo(
    () => (Array.isArray(screens) && screens.length > 0
      ? screens
      : [{ id: 'screen', title: 'Details', fields: [] }]),
    [screens],
  );

  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  /** Transient server/network failure — distinct from Task 8's flat 404 (invalid link). */
  const [submitError, setSubmitError] = useState(false);

  const current = safeScreens[Math.min(step, safeScreens.length - 1)];
  const isLast = step >= safeScreens.length - 1;

  const collectedPayload: JourneySubmitPayload = useMemo(() => ({
    journeyRecord: values,
    submittedData: values,
  }), [values]);

  function setField(id: string, value: string) {
    setValues((v) => ({ ...v, [id]: value }));
    setErrors((e) => {
      if (!e[id]) return e;
      const next = { ...e };
      delete next[id];
      return next;
    });
  }

  function validateCurrentScreen(): boolean {
    const nextErrors: Record<string, string> = {};
    for (const f of current.fields ?? []) {
      if (!f.required) continue;
      if (!isFilled(values[f.id])) {
        nextErrors[f.id] = 'This field is required';
      }
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function handleContinue() {
    if (!validateCurrentScreen()) return;
    if (isLast) {
      setReview(true);
      return;
    }
    setStep((s) => s + 1);
  }

  function handleBack() {
    if (review) {
      setReview(false);
      return;
    }
    setStep((s) => Math.max(0, s - 1));
  }

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(false);
    try {
      const res = await fetch(
        `${apiBase}/api/journeys/webhook/${encodeURIComponent(companyId)}/${encodeURIComponent(journeyInstanceId)}/${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(collectedPayload),
        },
      );
      // Task 8 collapses invalid-token / already-resumed / timed-out into 404 only.
      if (res.status === 404) {
        onInvalid();
        return;
      }
      if (!res.ok) {
        setSubmitError(true);
        return;
      }
      setDone(true);
    } catch {
      // Network / offline / abort — recoverable; do not claim the link is dead.
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div data-testid="journey-submitted" className="text-center">
        {accent && (
          <div
            className="mx-auto mb-3 h-1.5 w-16 rounded-full"
            style={{ backgroundColor: accent }}
            aria-hidden
          />
        )}
        <h1 className="text-xl font-semibold text-slate-900">Thank you</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your responses have been submitted. You can close this page.
        </p>
      </div>
    );
  }

  if (review) {
    return (
      <div data-testid="journey-review">
        <header className="mb-6 text-center">
          {accent && (
            <div
              className="mx-auto mb-3 h-1.5 w-16 rounded-full"
              style={{ backgroundColor: accent }}
              aria-hidden
            />
          )}
          <h1 className="text-xl font-semibold text-slate-900">
            {name?.trim() || 'Journey'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">Review your answers before submitting.</p>
        </header>

        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="space-y-5 text-left" data-testid="journey-review-summary">
            {safeScreens.map((screen) => {
              const fields = screen.fields ?? [];
              if (fields.length === 0) return null;
              const showScreenTitle = safeScreens.length > 1;
              return (
                <section key={screen.id}>
                  {showScreenTitle && (
                    <h2 className="mb-2 text-sm font-semibold text-slate-900">
                      {screen.title || 'Details'}
                    </h2>
                  )}
                  <dl className="space-y-2">
                    {fields.map((field) => {
                      const raw = values[field.id];
                      const display = isFilled(raw) ? raw!.trim() : '—';
                      return (
                        <div key={field.id} className="flex gap-2 text-sm">
                          <dt className="shrink-0 font-medium text-slate-500">
                            {field.label || 'Field'}:
                          </dt>
                          <dd className="min-w-0 break-words text-slate-900">{display}</dd>
                        </div>
                      );
                    })}
                  </dl>
                </section>
              );
            })}
          </div>
          {submitError && (
            <div className="mt-4" data-testid="journey-submit-error">
              <ErrorState
                title="Something went wrong"
                message="We could not submit your answers. Check your connection and try again — your link is still valid."
                onRetry={handleSubmit}
              />
            </div>
          )}
          <div className="mt-4 flex gap-3">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={handleBack}
              disabled={submitting}
            >
              Back
            </Button>
            <Button
              type="button"
              className="flex-[2]"
              style={accent ? { backgroundColor: accent } : undefined}
              onClick={handleSubmit}
              disabled={submitting}
              data-testid="journey-submit"
            >
              {submitting ? 'Submitting…' : submitError ? 'Try again' : 'Submit'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="journey-form">
      <header className="mb-4 text-center">
        {accent && (
          <div
            className="mx-auto mb-3 h-1.5 w-16 rounded-full"
            style={{ backgroundColor: accent }}
            aria-hidden
          />
        )}
        <h1 className="text-xl font-semibold text-slate-900">
          {name?.trim() || 'Journey'}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{current.title}</p>
      </header>

      <ScreenStepBar screens={safeScreens} step={step} accent={accent} />

      <div className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        {(current.fields ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">No fields on this screen.</p>
        ) : (
          (current.fields ?? []).map((field) => {
            const type = FIELD_TYPES.has(field.type) ? field.type : 'text';
            const value = values[field.id] ?? '';
            const error = errors[field.id];

            if (type === 'select') {
              return (
                <Select
                  key={field.id}
                  id={`jf-${field.id}`}
                  label={field.label}
                  required={field.required}
                  error={error}
                  placeholder="Select…"
                  options={[
                    ...(field.options ?? []).map((o) => ({ value: o, label: o })),
                  ]}
                  value={value}
                  onChange={(e) => setField(field.id, e.target.value)}
                />
              );
            }

            return (
              <Input
                key={field.id}
                id={`jf-${field.id}`}
                label={field.label}
                required={field.required}
                error={error}
                type={inputTypeFor(type)}
                phonePrefix={type === 'phone'}
                value={value}
                onChange={(e) => setField(field.id, e.target.value)}
                autoComplete={type === 'email' ? 'email' : type === 'phone' ? 'tel' : 'on'}
              />
            );
          })
        )}

        <div className="flex gap-3 pt-2">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={handleBack}
            disabled={step === 0}
          >
            Back
          </Button>
          <Button
            type="button"
            className="flex-[2]"
            style={accent ? { backgroundColor: accent, borderColor: accent } : undefined}
            onClick={handleContinue}
            data-testid="journey-continue"
          >
            {isLast ? 'Review →' : 'Continue →'}
          </Button>
        </div>
      </div>
    </div>
  );
}
