'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Loader2, ShieldCheck, RefreshCw } from 'lucide-react';
import { Drawer, DrawerFooter } from '@/components/v3/ui/Drawer';
import { Button } from '@/components/v3/ui/Button';
import { apiFetch, apiErrorMessage, ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { loadFacebookSdk, openEmbeddedSignup } from '@/lib/facebookSdk';
import {
  isEmbeddedSignupMessage, correlateSignupResult,
  type EmbeddedSignupMessageData,
} from '@/lib/embeddedSignupCorrelation';
import { STEP_ORDER, STEP_LABELS, isOnboardingComplete, type OnboardingStatus, type OnboardingStepResult } from '@/types/embeddedSignup';

interface ExchangeResponse {
  success: boolean;
  onboardingStatus: OnboardingStatus;
}

interface ResumeResponse {
  success: boolean;
  onboardingStatus: OnboardingStatus;
}

type Screen = 'welcome' | 'waiting' | 'confirmation' | 'success' | 'error';

interface WizardConfig {
  appId: string;
  configId: string;
  graphApiVersion: string;
}

interface EmbeddedSignupWizardProps {
  open: boolean;
  onClose: () => void;
  /** Fired once onboarding actually completes (all steps done) — the caller
   * uses this to invalidate config queries and trigger MetaHealthPanel's
   * auto-refresh, without the wizard needing to know about either. */
  onOnboarded: () => void;
  config: WizardConfig;
}

export function EmbeddedSignupWizard({ open, onClose, onOnboarded, config }: EmbeddedSignupWizardProps) {
  // No reset-on-open effect: the parent remounts this component with a fresh
  // `key` every time it opens the wizard (see settings/page.tsx), so these
  // initial values ARE the reset — a stale code/signupData from a previous,
  // abandoned attempt can never leak into a fresh one.
  //
  // `code` and `signupData` are two independent pieces of state, each
  // written by exactly one source (FB.login's callback / the WA_EMBEDDED_
  // SIGNUP message listener respectively) — no merging, no stale-closure
  // risk. Whether they're both present is a DERIVED value (see
  // `readyForConfirmation` below), not something a watcher effect needs to
  // compute and push into a third piece of state.
  const [screen, setScreen] = useState<Screen>('welcome');
  const [connecting, setConnecting] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [signupData, setSignupData] = useState<EmbeddedSignupMessageData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorRetryable, setErrorRetryable] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const correlation = correlateSignupResult({ code, signupData });
  // Computed at render time, not via an effect + extra state: the instant
  // both FB.login's code and the WA_EMBEDDED_SIGNUP message have arrived
  // (in either order), the waiting screen renders as Confirmation on that
  // very render — no extra render cycle, no race between two async sources.
  const effectiveScreen: Screen = screen === 'waiting' && correlation.ready ? 'confirmation' : screen;

  // Meta's Embedded Signup posts a WA_EMBEDDED_SIGNUP message to `window`
  // independently of FB.login()'s own callback — this listener runs for the
  // wizard's whole lifetime so it never misses the event regardless of
  // exactly when Meta's hosted popup posts it relative to FB.login resolving.
  useEffect(() => {
    if (!open) return;
    function onMessage(event: MessageEvent) {
      if (!isEmbeddedSignupMessage(event)) return;
      const { event: signupEvent, data } = event.data;
      if (signupEvent === 'CANCEL') {
        setScreen('error');
        setErrorMessage('You cancelled the WhatsApp connection in Facebook.');
        setErrorRetryable(true);
        return;
      }
      if (signupEvent === 'ERROR') {
        setScreen('error');
        setErrorMessage('Facebook reported an error during signup. Please try again.');
        setErrorRetryable(true);
        return;
      }
      setSignupData(data ?? null);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [open]);

  async function handleContinueWithFacebook() {
    setConnecting(true);
    setErrorMessage(null);
    try {
      await loadFacebookSdk(config.appId, config.graphApiVersion);
      setScreen('waiting');
      const response = await openEmbeddedSignup(config.configId);
      const returnedCode = response.authResponse?.code ?? null;
      if (!returnedCode) {
        // No separate WA_EMBEDDED_SIGNUP CANCEL event is guaranteed on every
        // cancellation path — FB.login's own callback returning no
        // authResponse is itself a valid, independent cancel signal.
        setScreen('error');
        setErrorMessage('WhatsApp connection was not completed in Facebook.');
        setErrorRetryable(true);
        return;
      }
      setCode(returnedCode);
    } catch (e: unknown) {
      setScreen('error');
      setErrorMessage(e instanceof Error ? e.message : 'Could not start the Facebook signup flow.');
      setErrorRetryable(true);
    } finally {
      setConnecting(false);
    }
  }

  async function handleConfirm() {
    const result = correlation;
    if (!result.ready) return;
    setExchanging(true);
    try {
      const data = await apiFetch<ExchangeResponse>('/api/whatsapp/embedded-signup/exchange', {
        method: 'POST',
        retries: 0,
        body: JSON.stringify({
          code: result.code,
          wabaId: result.wabaId,
          phoneNumberId: result.phoneNumberId,
          businessId: result.businessId,
        }),
      });
      // persistConfig failing means nothing was actually saved -- the
      // company is still unconnected, so this is a real failure (not a
      // "connected but one step degraded" case), and there's nothing to
      // resume: starting over from Welcome is the only real option.
      if (data.onboardingStatus.steps.persistConfig.status === 'failed') {
        setScreen('error');
        setErrorMessage(data.onboardingStatus.steps.persistConfig.error ?? 'Could not save the WhatsApp configuration.');
        setErrorRetryable(true);
        return;
      }
      setStatus(data.onboardingStatus);
      setScreen('success');
      // Fires whenever persistConfig succeeded, not just on full pipeline
      // completion -- the company is now "connected" (GET /config/full's
      // cfg.connected) even if a later step (e.g. syncTemplates) failed, so
      // the parent's cache must refresh either way.
      onOnboarded();
    } catch (e: unknown) {
      // CODE_EXCHANGE_FAILED means the authorization code itself is dead
      // (expired/reused) — retrying can't work without a fresh FB.login(),
      // so this always sends the user back to Welcome, never offers "resume".
      const code = e instanceof ApiClientError ? (e.body?.code as string | undefined) : undefined;
      setScreen('error');
      setErrorMessage(apiErrorMessage(e, 'Could not complete the WhatsApp connection.'));
      setErrorRetryable(code !== 'CODE_EXCHANGE_FAILED');
    } finally {
      setExchanging(false);
    }
  }

  function handleTryAgain() {
    setScreen('welcome');
    setCode(null);
    setSignupData(null);
    setErrorMessage(null);
    setStatus(null);
  }

  // Re-runs only the steps still marked failed/pending — no need to redo
  // Facebook login, since persistConfig already succeeded (that's the only
  // way this button is reachable at all). Same endpoint the standalone
  // OnboardingResumeBanner uses for a session resumed after the tab closed.
  async function handleRetryFailedSteps() {
    setRetrying(true);
    setRetryError(null);
    try {
      const data = await apiFetch<ResumeResponse>('/api/whatsapp/embedded-signup/resume', { method: 'POST', retries: 0 });
      setStatus(data.onboardingStatus);
      onOnboarded();
    } catch (e: unknown) {
      setRetryError(apiErrorMessage(e, 'Could not retry the remaining setup steps.'));
    } finally {
      setRetrying(false);
    }
  }

  function handleFinish() {
    onClose();
  }

  const allStepsDone = isOnboardingComplete(status);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Connect WhatsApp"
      description="Guided setup via Meta Embedded Signup — no IDs or tokens to copy."
      footer={<WizardFooter screen={effectiveScreen} connecting={connecting} exchanging={exchanging} errorRetryable={errorRetryable}
        onClose={onClose} onContinue={handleContinueWithFacebook} onConfirm={handleConfirm}
        onTryAgain={handleTryAgain} onFinish={handleFinish} />}
    >
      {effectiveScreen === 'welcome' && (
        <div className="space-y-4">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            APForce will open a secure Facebook window where you sign in and choose (or create) your
            Business Manager, WhatsApp Business Account, and phone number — all inside Facebook&apos;s
            own screens.
          </p>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-800/40">
            <p className="mb-2 text-xs font-semibold text-neutral-700 dark:text-neutral-300">APForce will automatically:</p>
            <ul className="space-y-1 text-xs text-neutral-500">
              <li>• Subscribe to Meta webhooks so messages arrive instantly</li>
              <li>• Register your phone number for Cloud API + two-step PIN</li>
              <li>• Sync your business profile and message templates</li>
              <li>• Run a full health check before you&apos;re done</li>
            </ul>
          </div>
        </div>
      )}

      {effectiveScreen === 'waiting' && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" aria-hidden />
          <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Waiting for Facebook…</p>
          <p className="max-w-xs text-xs text-neutral-500">
            Complete the steps in the Facebook window. This drawer will update automatically once you&apos;re done.
          </p>
        </div>
      )}

      {effectiveScreen === 'confirmation' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-success-200 bg-success-50 p-3 dark:border-success-800 dark:bg-success-900/20">
            <ShieldCheck className="h-4 w-4 shrink-0 text-success-600 dark:text-success-400" />
            <p className="text-xs text-success-700 dark:text-success-300">Facebook returned the following — confirm to connect.</p>
          </div>
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            <ConfirmRow label="WABA ID" value={correlation.wabaId} />
            <ConfirmRow label="Phone Number ID" value={correlation.phoneNumberId} />
            <ConfirmRow label="Business ID" value={correlation.businessId} />
          </div>
        </div>
      )}

      {effectiveScreen === 'success' && status && (
        <div className="space-y-4">
          <div className={cn(
            'rounded-lg border p-3 text-xs',
            allStepsDone
              ? 'border-success-200 bg-success-50 text-success-700 dark:border-success-800 dark:bg-success-900/20 dark:text-success-400'
              : 'border-warning-200 bg-warning-50 text-warning-700 dark:border-warning-800 dark:bg-warning-900/20 dark:text-warning-400',
          )}>
            {allStepsDone
              ? 'WhatsApp is connected and fully configured.'
              : 'Connected, but one or more setup steps need attention — check Meta Health after closing this wizard.'}
          </div>
          <div className="space-y-1.5 rounded-lg border border-neutral-100 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-800/40">
            {STEP_ORDER.map((key) => (
              <StepRow key={key} label={STEP_LABELS[key]} result={status.steps[key]} />
            ))}
          </div>
          {!allStepsDone && (
            <div className="space-y-2">
              <Button variant="secondary" size="sm" loading={retrying} onClick={handleRetryFailedSteps} iconLeft={<RefreshCw className="h-3.5 w-3.5" />}>
                Retry Failed Steps
              </Button>
              {retryError && <p className="text-xs text-error-600 dark:text-error-400">{retryError}</p>}
            </div>
          )}
        </div>
      )}

      {effectiveScreen === 'error' && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <XCircle className="h-8 w-8 text-error-500" aria-hidden />
          <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{errorMessage}</p>
        </div>
      )}
    </Drawer>
  );
}

function WizardFooter({ screen, connecting, exchanging, errorRetryable, onClose, onContinue, onConfirm, onTryAgain, onFinish }: {
  screen: Screen; connecting: boolean; exchanging: boolean; errorRetryable: boolean;
  onClose: () => void; onContinue: () => void; onConfirm: () => void; onTryAgain: () => void; onFinish: () => void;
}) {
  if (screen === 'welcome') {
    return (
      <DrawerFooter>
        <Button variant="secondary" size="md" onClick={onClose}>Cancel</Button>
        <Button variant="primary" size="md" loading={connecting} onClick={onContinue}>Continue with Facebook</Button>
      </DrawerFooter>
    );
  }
  if (screen === 'waiting') {
    return (
      <DrawerFooter>
        <Button variant="secondary" size="md" onClick={onClose}>Cancel</Button>
      </DrawerFooter>
    );
  }
  if (screen === 'confirmation') {
    return (
      <DrawerFooter>
        <Button variant="secondary" size="md" onClick={onClose} disabled={exchanging}>Cancel</Button>
        <Button variant="primary" size="md" loading={exchanging} onClick={onConfirm}>Confirm & Connect</Button>
      </DrawerFooter>
    );
  }
  if (screen === 'success') {
    return (
      <DrawerFooter>
        <Button variant="primary" size="md" onClick={onFinish}>Go to Meta Health</Button>
      </DrawerFooter>
    );
  }
  // error
  return (
    <DrawerFooter>
      <Button variant="secondary" size="md" onClick={onClose}>Close</Button>
      {errorRetryable && <Button variant="primary" size="md" onClick={onTryAgain}>Try Again</Button>}
    </DrawerFooter>
  );
}

function ConfirmRow({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-xs">
      <span className="text-neutral-500">{label}</span>
      <span className="font-mono text-neutral-800 dark:text-neutral-200">{value ?? '—'}</span>
    </div>
  );
}

function StepRow({ label, result }: { label: string; result: OnboardingStepResult }) {
  const Icon = result.status === 'done' ? CheckCircle : result.status === 'failed' ? XCircle : RefreshCw;
  const cls = result.status === 'done'
    ? 'text-success-600 dark:text-success-400'
    : result.status === 'failed'
    ? 'text-error-600 dark:text-error-400'
    : 'text-neutral-400';
  return (
    <div className="flex items-start gap-2 py-1">
      <Icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${cls} ${result.status === 'pending' ? 'animate-spin' : ''}`} aria-hidden />
      <div className="min-w-0">
        <p className={`text-xs font-medium ${cls}`}>{label}</p>
        {result.error && <p className="mt-0.5 text-[10px] leading-relaxed text-neutral-500">{result.error}</p>}
        {result.pinGenerated && <p className="mt-0.5 text-[10px] leading-relaxed text-neutral-500">PIN set — view it in Meta Health after closing.</p>}
      </div>
    </div>
  );
}
