// Meta's Embedded Signup posts session info to `window` via a `message`
// event, SEPARATELY from FB.login()'s own promise-style callback (which only
// ever returns { authResponse: { code } }). The wizard needs both — the code
// to exchange for a token, and this event's `data` for the WABA/phone/
// business ids — before it can call the backend. Pulled into pure,
// unit-testable functions so the join logic isn't buried inside a component.

export interface EmbeddedSignupMessageData {
  phone_number_id?: string;
  waba_id?: string;
  business_id?: string;
  [key: string]: unknown;
}

export interface EmbeddedSignupMessage {
  type: 'WA_EMBEDDED_SIGNUP';
  event: 'FINISH' | 'CANCEL' | 'ERROR';
  data?: EmbeddedSignupMessageData;
}

// Meta posts this message from its own hosted signup surface.
// VERIFY DURING IMPLEMENTATION / BEFORE LIVE TESTING: confirm the exact
// origin(s) against Meta's current Embedded Signup docs — this only gates
// which messages get *parsed*, it never gates a privileged action on its
// own (the actual exchange call is a separate, explicit, backend-verified
// step), so a slightly-wrong origin list fails safe (messages get ignored),
// but should still be confirmed before relying on it.
const TRUSTED_ORIGINS = new Set(['https://www.facebook.com', 'https://web.facebook.com']);

export function isEmbeddedSignupMessage(event: MessageEvent): event is MessageEvent<EmbeddedSignupMessage> {
  if (!TRUSTED_ORIGINS.has(event.origin)) return false;
  const data: unknown = event.data;
  return !!data && typeof data === 'object' && (data as { type?: unknown }).type === 'WA_EMBEDDED_SIGNUP';
}

export interface SignupCorrelationInput {
  code: string | null;
  signupData: EmbeddedSignupMessageData | null;
}

export interface SignupCorrelationResult {
  ready: boolean;
  code?: string;
  wabaId?: string;
  phoneNumberId?: string;
  businessId?: string;
}

/**
 * Joins FB.login's authorization code with the WA_EMBEDDED_SIGNUP message's
 * ids. Both must be present — and the message's ids must actually be
 * populated — before the wizard can advance to the Confirmation screen.
 */
export function correlateSignupResult({ code, signupData }: SignupCorrelationInput): SignupCorrelationResult {
  if (!code || !signupData?.waba_id || !signupData?.phone_number_id) {
    return { ready: false };
  }
  return {
    ready: true,
    code,
    wabaId: signupData.waba_id,
    phoneNumberId: signupData.phone_number_id,
    businessId: signupData.business_id,
  };
}
