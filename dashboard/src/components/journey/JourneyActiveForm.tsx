'use client';

/**
 * Active-journey multi-screen form (Phase 3 Task 2 + Task 3 + Payment wire).
 * Reuses v3 Input/Select/Button (auth-free — only import @/lib/cn).
 * Step navigation mirrors onboarding's step index + Back/Continue pattern.
 * Collected values are a flat Record<fieldId, string>; submit-ready payload
 * wraps as { journeyRecord, submittedData } — keys create_journey_record reads
 * (AutomationEngine.js: ctx.journeyRecord ?? ctx.submittedData).
 *
 * CTA / path follows final payable amount only (pricingSummary.total) — not anyPriced —
 * so ₹0 (qty 0, free unitPrice, future discounts) skips Razorpay:
 *   total <= 0 → Book Now → Task 8 webhook-resume
 *   total > 0  → Pay & Register → checkout → Razorpay → poll until 'paid'
 * (Checkout success is UX-only, never completion.)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Hash, List, Mail, Phone, Type, type LucideIcon } from 'lucide-react';
import { Input } from '@/components/v3/ui/Input';
import { Select } from '@/components/v3/ui/Select';
import { Button } from '@/components/v3/ui/Button';
import { ErrorState } from '@/components/v3/ui/ErrorState';
import {
  formatInr,
  formatLine,
  hasUnitPrice,
  pricingBreakdown,
} from '@/lib/journeys/pricing';
import { openRazorpayCheckout } from '@/lib/journeys/razorpayCheckout';
import { pollPaymentStatus } from '@/lib/journeys/pollPaymentStatus';

export interface JourneyScreenField {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  /** Optional ₹ unit price for type:'number'. 0 = free item; omit = no price UI. */
  unitPrice?: number;
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

export interface JourneyGstConfig {
  gstEnabled?: boolean;
  gstPercent?: number;
  gstMode?: 'exclusive' | 'inclusive';
}

/** Review CTA / payment UX phases (priced path only). */
type PayUiPhase =
  | 'idle'
  | 'starting'
  | 'awaiting_gateway'
  | 'confirming'
  | 'gateway_failed'
  | 'confirm_slow'
  | 'checkout_error';

const FIELD_TYPES = new Set(['text', 'select', 'phone', 'date', 'email', 'number']);

function inputTypeFor(type: string): string {
  if (type === 'email') return 'email';
  if (type === 'date') return 'date';
  if (type === 'phone') return 'tel';
  if (type === 'number') return 'number';
  return 'text';
}

function iconForFieldType(type: string): LucideIcon {
  switch (type) {
    case 'email':
      return Mail;
    case 'phone':
      return Phone;
    case 'date':
      return Calendar;
    case 'select':
      return List;
    case 'number':
      return Hash;
    default:
      return Type;
  }
}

function isFilled(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

/** Full-width ~3:1 banner; hides entirely on missing/broken URL. */
export function JourneyBanner({ url }: { url: string | null | undefined }) {
  const [failed, setFailed] = useState(false);
  const src = typeof url === 'string' ? url.trim() : '';
  if (!src || failed) return null;
  return (
    <div
      className="mb-5 w-full overflow-hidden rounded-2xl bg-slate-100 aspect-[3/1]"
      data-testid="journey-banner"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary customer URL; next/image needs a remotePatterns allowlist we don't have */}
      <img
        src={src}
        alt=""
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  );
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
  bannerImageUrl,
  gst,
  companyId,
  journeyInstanceId,
  token,
  apiBase,
  onInvalid,
}: {
  name: string | null;
  screens: JourneyScreen[];
  accent: string | null;
  /** Optional public banner from brandingConfig.bannerImageUrl. */
  bannerImageUrl?: string | null;
  /** Definition-level GST — ignored when no priced fields. */
  gst?: JourneyGstConfig | null;
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
  const [payPhase, setPayPhase] = useState<PayUiPhase>('idle');
  const [activePaymentId, setActivePaymentId] = useState<string | null>(null);
  /** Abort in-flight status polls on unmount / new poll / leave review. */
  const pollAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      pollAbortRef.current?.abort();
      pollAbortRef.current = null;
    };
  }, []);

  const current = safeScreens[Math.min(step, safeScreens.length - 1)];
  const isLast = step >= safeScreens.length - 1;

  const collectedPayload: JourneySubmitPayload = useMemo(() => ({
    journeyRecord: values,
    submittedData: values,
  }), [values]);

  // Display-only — never merged into collectedPayload / webhook body / charged amount.
  const pricingSummary = useMemo(
    () => pricingBreakdown(safeScreens, values, gst ?? {}),
    [safeScreens, values, gst],
  );

  // Path gate: final payable amount only (anyPriced is display / Totals panel only).
  const isPayable = pricingSummary.total > 0;

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
      pollAbortRef.current?.abort();
      pollAbortRef.current = null;
      setReview(false);
      setPayPhase('idle');
      setSubmitError(false);
      return;
    }
    setStep((s) => Math.max(0, s - 1));
  }

  function paymentStatusUrl(paymentId: string): string {
    return (
      `${apiBase}/api/journeys/${encodeURIComponent(companyId)}/`
      + `${encodeURIComponent(journeyInstanceId)}/${encodeURIComponent(token)}/`
      + `payments/${encodeURIComponent(paymentId)}`
    );
  }

  async function runPaymentPoll(paymentId: string) {
    pollAbortRef.current?.abort();
    const ac = new AbortController();
    pollAbortRef.current = ac;

    setPayPhase('confirming');
    setActivePaymentId(paymentId);
    const outcome = await pollPaymentStatus({
      url: paymentStatusUrl(paymentId),
      signal: ac.signal,
    });
    if (ac.signal.aborted || outcome.kind === 'aborted') {
      return;
    }
    if (outcome.kind === 'paid') {
      setDone(true);
      setSubmitting(false);
      return;
    }
    if (outcome.kind === 'timeout') {
      setPayPhase('confirm_slow');
      setSubmitting(false);
      return;
    }
    // terminal (paid_duplicate / failed / refunded) or error
    setPayPhase('checkout_error');
    setSubmitError(true);
    setSubmitting(false);
  }

  /** Free journeys only — Book Now → webhook resume (unchanged). */
  async function handleSubmit() {
    if (submitting || isPayable) return;
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

  /**
   * Priced journeys — Pay & Register → server checkout → Razorpay → poll 'paid'.
   * Client never sends amount; Checkout success never completes the UI alone.
   */
  async function handlePayAndRegister() {
    if (submitting || !isPayable) return;
    setSubmitting(true);
    setSubmitError(false);
    setPayPhase('starting');
    try {
      const res = await fetch(
        `${apiBase}/api/journeys/${encodeURIComponent(companyId)}/${encodeURIComponent(journeyInstanceId)}/${encodeURIComponent(token)}/checkout`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Field values only — never amount / amountPaise / total.
          body: JSON.stringify({ submittedData: values }),
        },
      );
      if (res.status === 404) {
        onInvalid();
        return;
      }
      if (!res.ok) {
        setPayPhase('checkout_error');
        setSubmitError(true);
        setSubmitting(false);
        return;
      }

      const data = await res.json() as {
        order_id?: string;
        key_id?: string;
        amount?: number;
        currency?: string;
        paymentId?: string;
      };

      if (!data.order_id || !data.key_id || data.amount == null || !data.paymentId) {
        setPayPhase('checkout_error');
        setSubmitError(true);
        setSubmitting(false);
        return;
      }

      setActivePaymentId(data.paymentId);
      setPayPhase('awaiting_gateway');

      await openRazorpayCheckout({
        keyId: data.key_id,
        orderId: data.order_id,
        amountPaise: Number(data.amount),
        currency: data.currency || 'INR',
        name: name?.trim() || 'Registration',
        prefill: {
          name: values.full_name || values.name || undefined,
          email: values.email || undefined,
          contact: values.tel || values.phone || values.mobile || undefined,
        },
        onSuccess: () => {
          // UX only — do NOT setDone here; wait for webhook-confirmed 'paid'.
          void runPaymentPoll(data.paymentId!);
        },
        onDismiss: () => {
          // User closed Checkout — PAYMENT# stays pending; return to review.
          setPayPhase('idle');
          setSubmitting(false);
        },
        onFailure: () => {
          setPayPhase('gateway_failed');
          setSubmitting(false);
        },
      });
    } catch {
      setPayPhase('checkout_error');
      setSubmitError(true);
      setSubmitting(false);
    }
  }

  function handlePrimaryAction() {
    if (isPayable) void handlePayAndRegister();
    else void handleSubmit();
  }

  function primaryLabel(): string {
    if (isPayable) {
      if (payPhase === 'starting' || payPhase === 'awaiting_gateway') return 'Opening payment…';
      if (payPhase === 'confirming') return 'Confirming payment…';
      if (payPhase === 'gateway_failed' || payPhase === 'checkout_error' || submitError) {
        return 'Try payment again';
      }
      return 'Pay & Register';
    }
    if (submitting) return 'Booking…';
    if (submitError) return 'Try again';
    return 'Book Now';
  }

  if (done) {
    return (
      <div data-testid="journey-submitted" className="text-center">
        <JourneyBanner url={bannerImageUrl} />
        {accent && (
          <div
            className="mx-auto mb-3 h-1.5 w-16 rounded-full"
            style={{ backgroundColor: accent }}
            aria-hidden
          />
        )}
        <h1 className="text-xl font-semibold text-slate-900">Thank you</h1>
        <p className="mt-2 text-sm text-slate-600">
          {isPayable
            ? 'Your payment is confirmed and your booking is complete. You can close this page.'
            : 'Your responses have been submitted. You can close this page.'}
        </p>
      </div>
    );
  }

  if (payPhase === 'confirming') {
    return (
      <div data-testid="journey-payment-confirming" className="text-center">
        <JourneyBanner url={bannerImageUrl} />
        <h1 className="text-xl font-semibold text-slate-900">Confirming your payment…</h1>
        <p className="mt-2 text-sm text-slate-600">
          Please wait while we confirm your payment with the bank. Do not close this page.
        </p>
      </div>
    );
  }

  if (payPhase === 'confirm_slow') {
    return (
      <div data-testid="journey-payment-pending" className="text-center">
        <JourneyBanner url={bannerImageUrl} />
        <h1 className="text-xl font-semibold text-slate-900">We&apos;re confirming your payment</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your payment may already have gone through. You&apos;ll receive a WhatsApp confirmation
          shortly — this is not a failed booking.
        </p>
        <div className="mt-6">
          <Button
            type="button"
            style={accent ? { backgroundColor: accent } : undefined}
            data-testid="journey-payment-recheck"
            onClick={() => {
              if (!activePaymentId) return;
              setSubmitting(true);
              void runPaymentPoll(activePaymentId);
            }}
            disabled={submitting || !activePaymentId}
          >
            {submitting ? 'Checking…' : 'Check payment status'}
          </Button>
        </div>
      </div>
    );
  }

  if (review) {
    return (
      <div data-testid="journey-review">
        <JourneyBanner url={bannerImageUrl} />
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
          <p className="mt-1 text-sm text-slate-500">
            {isPayable
              ? 'Review your answers, then pay to complete registration.'
              : 'Review your answers before booking.'}
          </p>
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
                    <h2 className="mb-3 text-sm font-semibold text-slate-900">
                      {screen.title || 'Details'}
                    </h2>
                  )}
                  <ul className="space-y-3">
                    {fields.map((field) => {
                      const Icon = iconForFieldType(field.type);
                      const raw = values[field.id];
                      const display = isFilled(raw) ? raw!.trim() : '—';
                      return (
                        <li key={field.id} className="flex items-start gap-3">
                          <span
                            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600"
                            aria-hidden
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-slate-500">
                              {field.label || 'Field'}
                            </p>
                            <p className="break-words text-sm text-slate-900">{display}</p>
                            {hasUnitPrice(field) && (
                              <p className="mt-0.5 text-xs text-slate-500">
                                {formatLine(raw, field.unitPrice!)}
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>

          {pricingSummary.anyPriced && (
            pricingSummary.showGst ? (
              <div
                className="mt-4 space-y-2 border-t border-slate-200 pt-3"
                data-testid="journey-pricing"
              >
                <div className="flex items-center justify-between text-sm text-slate-600">
                  <span>Subtotal</span>
                  <span className="text-slate-900">{formatInr(pricingSummary.subtotal)}</span>
                </div>
                <div
                  className="flex items-center justify-between text-sm text-slate-600"
                  data-testid="journey-gst-line"
                >
                  {pricingSummary.gstMode === 'exclusive' ? (
                    <>
                      <span>{`GST (${pricingSummary.gstPercent}%):`}</span>
                      <span className="text-slate-900">{`+${formatInr(pricingSummary.gstAmount)}`}</span>
                    </>
                  ) : (
                    <>
                      <span>{`GST (${pricingSummary.gstPercent}%) included:`}</span>
                      <span className="text-slate-900">{formatInr(pricingSummary.gstAmount)}</span>
                    </>
                  )}
                </div>
                <div
                  className="flex items-center justify-between border-t-2 border-slate-800 pt-2 text-sm font-bold"
                  data-testid="journey-grand-total"
                >
                  <span className="text-slate-900">Total</span>
                  <span style={accent ? { color: accent } : undefined} className="text-slate-900">
                    {formatInr(pricingSummary.total)}
                  </span>
                </div>
              </div>
            ) : (
              <div
                className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-sm"
                data-testid="journey-grand-total"
              >
                <span className="font-semibold text-slate-900">Total</span>
                <span className="font-semibold text-slate-900">
                  {formatInr(pricingSummary.total)}
                </span>
              </div>
            )
          )}

          {payPhase === 'gateway_failed' && (
            <div className="mt-4" data-testid="journey-payment-failed">
              <ErrorState
                title="Payment did not go through"
                message="Your card or UPI was not charged successfully. You can try again — we will reuse the same pending payment when possible."
                onRetry={handlePrimaryAction}
              />
            </div>
          )}

          {(submitError || payPhase === 'checkout_error') && payPhase !== 'gateway_failed' && (
            <div className="mt-4" data-testid="journey-submit-error">
              <ErrorState
                title="Something went wrong"
                message={
                  isPayable
                    ? 'We could not start checkout. Check your connection and try again — your link is still valid.'
                    : 'We could not submit your answers. Check your connection and try again — your link is still valid.'
                }
                onRetry={handlePrimaryAction}
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
              onClick={handlePrimaryAction}
              disabled={submitting}
              data-testid="journey-submit"
              data-pay-action={isPayable ? 'pay-register' : 'book-now'}
            >
              {primaryLabel()}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="journey-form">
      <JourneyBanner url={bannerImageUrl} />
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
              <div key={field.id}>
                <Input
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
                {type === 'number' && hasUnitPrice(field) && (
                  <p
                    className="mt-1.5 text-xs font-medium text-slate-500"
                    data-testid={`journey-line-total-${field.id}`}
                  >
                    {formatLine(value, field.unitPrice!)}
                  </p>
                )}
              </div>
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
