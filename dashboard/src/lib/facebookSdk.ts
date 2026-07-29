'use client';

// Lazy loader for Meta's JavaScript SDK (Embedded Signup, PR 7b). Only
// injected the first time a caller actually needs it (the wizard opening) —
// never a global <Script> in layout.tsx — so every page that never touches
// WhatsApp connect never pays for it. See ADR-024.

export interface FacebookLoginResponse {
  authResponse?: { code?: string } | null;
  status?: string;
}

export interface FacebookLoginOptions {
  config_id: string;
  response_type: 'code';
  override_default_response_type: true;
  extras?: { setup?: Record<string, unknown>; featureType?: string; sessionInfoVersion?: string };
}

interface FacebookSdk {
  init: (params: { appId: string; version: string; xfbml: boolean }) => void;
  login: (callback: (response: FacebookLoginResponse) => void, options: FacebookLoginOptions) => void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

const SDK_SRC = 'https://connect.facebook.net/en_US/sdk.js';

let sdkPromise: Promise<void> | null = null;

/**
 * Loads Meta's JS SDK and calls FB.init() exactly once — memoized so
 * repeated wizard opens never re-inject the script tag or re-init.
 */
export function loadFacebookSdk(appId: string, graphApiVersion: string): Promise<void> {
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    if (window.FB) {
      window.FB.init({ appId, version: graphApiVersion, xfbml: false });
      resolve();
      return;
    }

    window.fbAsyncInit = () => {
      window.FB!.init({ appId, version: graphApiVersion, xfbml: false });
      resolve();
    };

    const script = document.createElement('script');
    script.src = SDK_SRC;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => {
      sdkPromise = null; // allow a retry on the next wizard open
      reject(new Error('Failed to load the Facebook SDK — check your network connection and try again.'));
    };
    document.body.appendChild(script);
  });

  return sdkPromise;
}

/**
 * Opens Meta's Embedded Signup flow via FB.login(). Meta's own hosted UI
 * handles Business Manager / WABA / Phone Number selection-or-creation
 * entirely inside the popup this opens — APForce renders none of those
 * screens itself (see ADR-024). This function only surfaces the
 * authorization code (or cancellation) FB.login's own callback returns.
 *
 * The WABA_ID/PHONE_NUMBER_ID/business_id the backend pipeline also needs
 * arrive via a SEPARATE `window.message` event Meta posts independently of
 * this callback — see embeddedSignupCorrelation.ts for how the two are
 * joined before the wizard advances past the waiting screen.
 */
export function openEmbeddedSignup(configId: string): Promise<FacebookLoginResponse> {
  return new Promise((resolve, reject) => {
    if (!window.FB) {
      reject(new Error('Facebook SDK is not loaded — call loadFacebookSdk() first.'));
      return;
    }
    window.FB.login(
      (response) => resolve(response),
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
      },
    );
  });
}
