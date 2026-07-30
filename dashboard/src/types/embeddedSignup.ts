// Shared types for Meta Embedded Signup (ADR-024) — mirror
// EmbeddedSignupService's onboardingStatus shape exactly
// (src/services/EmbeddedSignupService.js is authoritative). Used by the
// onboarding wizard, the resume banner, and the Settings > WhatsApp page's
// FullWabaConfig type — pulled into one file so all three read the same
// contract instead of three hand-copied versions drifting apart.

export type StepKey =
  | 'persistConfig'
  | 'subscribeWebhooks'
  | 'registerPhone'
  | 'syncBusinessProfile'
  | 'syncTemplates'
  | 'healthCheck';

export interface OnboardingStepResult {
  status: 'pending' | 'done' | 'failed';
  at?: string;
  error?: string;
  detail?: string;
  pinGenerated?: string;
  code?: string;
}

export interface OnboardingStatus {
  startedAt: string;
  completedAt: string | null;
  steps: Record<StepKey, OnboardingStepResult>;
}

export const STEP_ORDER: StepKey[] = [
  'persistConfig', 'subscribeWebhooks', 'registerPhone', 'syncBusinessProfile', 'syncTemplates', 'healthCheck',
];

// Business-friendly wording — these render next to a spinner while pending
// and a checkmark once done, so phrasing stays natural in both states
// rather than switching tense (e.g. not "Message Templates Ready" while
// still spinning).
export const STEP_LABELS: Record<StepKey, string> = {
  persistConfig: 'Saving your connection details',
  subscribeWebhooks: 'Turning on instant messaging',
  registerPhone: 'Activating your phone number',
  syncBusinessProfile: 'Loading your business profile',
  syncTemplates: 'Loading your message templates',
  healthCheck: 'Checking your connection',
};

export function isOnboardingComplete(status: OnboardingStatus | null | undefined): boolean {
  if (!status) return false;
  return STEP_ORDER.every((k) => status.steps[k]?.status === 'done');
}
