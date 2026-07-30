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

// Meta posts this message from its own hosted signup surface. Live
// verification (2026-07-30) found the previous exact-match allowlist
// (only 'https://www.facebook.com' / 'https://web.facebook.com') silently
// dropped the real FINISH message — Meta posts from other facebook.com
// subdomains too, matching their own reference implementation's check
// (`event.origin.endsWith('facebook.com')`). Dropping the message left
// `signupData` unset forever, so the wizard never advanced past "Waiting
// for Facebook…" even though Meta's popup completed successfully. Matching
// any facebook.com subdomain (not a raw string-suffix match, which would
// also wrongly accept a host like "evilfacebook.com") fixes this while
// keeping the fail-safe property: this only gates which messages get
// *parsed*, never a privileged action on its own — the actual exchange
// call is a separate, explicit, backend-verified step.
function isTrustedFacebookOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === 'https:' && (hostname === 'facebook.com' || hostname.endsWith('.facebook.com'));
  } catch {
    return false;
  }
}

// Meta sends this message's `data` as a JSON-ENCODED STRING in production
// (confirmed against real Embedded Signup integration references, 2026-07-30
// live-verification round 2) -- not a live object, which is what Playwright's
// `postMessage(obj)` in the E2E spec produces (structured-clone, no
// stringify), so CI could never have caught this. `isEmbeddedSignupMessage`'s
// old `typeof data === 'object'` check silently rejected the real string
// payload regardless of origin -- the actual second break in the chain, on
// top of the origin-allowlist bug fixed earlier today.
export function parseEmbeddedSignupMessage(event: MessageEvent): EmbeddedSignupMessage | null {
  if (!isTrustedFacebookOrigin(event.origin)) return null;
  let parsed: unknown = event.data;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { type?: unknown }).type !== 'WA_EMBEDDED_SIGNUP') {
    return null;
  }
  return parsed as EmbeddedSignupMessage;
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
