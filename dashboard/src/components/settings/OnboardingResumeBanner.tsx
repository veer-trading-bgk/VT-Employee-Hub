'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/v3/ui/Button';
import { apiFetch, apiErrorMessage } from '@/lib/api';
import { STEP_ORDER, type OnboardingStatus } from '@/types/embeddedSignup';
import { toast } from 'sonner';

interface ResumeResponse {
  success: boolean;
  onboardingStatus: OnboardingStatus;
}

interface OnboardingResumeBannerProps {
  onboardingStatus: OnboardingStatus;
  /** Invalidate the config/health queries the parent owns — mirrors the
   * wizard's onOnboarded prop, keeping this banner as unaware of React
   * Query's cache keys as EmbeddedSignupWizard is. */
  onResumed: () => void;
}

// Shown on the Settings > WhatsApp page when an Embedded Signup connection
// exists but its pipeline never finished — e.g. the user closed the tab
// mid-onboarding, or a step failed and they left before retrying from the
// wizard's own Success screen. Calls the SAME /embedded-signup/resume
// endpoint the wizard's "Retry Failed Steps" button uses; no need to redo
// Facebook login since persistConfig already succeeded (that's the only way
// this banner is ever shown at all — see GET /config/full's onboardingStatus).
export function OnboardingResumeBanner({ onboardingStatus, onResumed }: OnboardingResumeBannerProps) {
  const [resuming, setResuming] = useState(false);

  const doneCount = STEP_ORDER.filter((k) => onboardingStatus.steps[k]?.status === 'done').length;

  async function handleResume() {
    setResuming(true);
    try {
      const data = await apiFetch<ResumeResponse>('/api/whatsapp/embedded-signup/resume', { method: 'POST', retries: 0 });
      const nowDone = STEP_ORDER.filter((k) => data.onboardingStatus.steps[k]?.status === 'done').length;
      if (data.onboardingStatus.completedAt) {
        toast.success('WhatsApp setup completed');
      } else {
        toast.warning(`${nowDone}/${STEP_ORDER.length} setup steps complete — some still need attention, see Meta Health`);
      }
      onResumed();
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, 'Could not resume WhatsApp setup'));
    } finally {
      setResuming(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-warning-200 bg-warning-50 p-3 dark:border-warning-800 dark:bg-warning-900/20">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning-600 dark:text-warning-400" aria-hidden />
        <div>
          <p className="text-xs font-semibold text-warning-800 dark:text-warning-200">WhatsApp setup is incomplete</p>
          <p className="text-xs text-warning-700 dark:text-warning-300">{doneCount}/{STEP_ORDER.length} steps finished — finish setup to enable full messaging.</p>
        </div>
      </div>
      <Button size="sm" variant="primary" loading={resuming} onClick={handleResume}>
        Finish Setup
      </Button>
    </div>
  );
}
