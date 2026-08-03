'use client';

/**
 * Lazy Razorpay Checkout.js loader — mirrors facebookSdk.ts (inject once, no
 * global layout Script). No existing Razorpay client found in this codebase.
 *
 * Amount / order_id / key MUST come from the server checkout response — never
 * from client pricing. Checkout success callback is UX-only; confirmation is
 * the server webhook + payment-status poll.
 */

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

export interface RazorpayCheckoutSuccess {
  razorpay_payment_id?: string;
  razorpay_order_id?: string;
  razorpay_signature?: string;
}

export interface RazorpayCheckoutFailure {
  error?: {
    code?: string;
    description?: string;
    reason?: string;
  };
}

interface RazorpayInstance {
  open: () => void;
  on: (event: 'payment.failed', handler: (resp: RazorpayCheckoutFailure) => void) => void;
}

interface RazorpayConstructor {
  new (options: Record<string, unknown>): RazorpayInstance;
}

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

let checkoutPromise: Promise<void> | null = null;

export function loadRazorpayCheckout(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Razorpay Checkout requires a browser'));
  }
  if (window.Razorpay) return Promise.resolve();
  if (checkoutPromise) return checkoutPromise;

  checkoutPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
    if (existing && window.Razorpay) {
      resolve();
      return;
    }

    const script = existing ?? document.createElement('script');
    if (!existing) {
      script.src = CHECKOUT_SRC;
      script.async = true;
      document.body.appendChild(script);
    }
    script.onload = () => {
      if (!window.Razorpay) {
        checkoutPromise = null;
        reject(new Error('Razorpay Checkout failed to initialize'));
        return;
      }
      resolve();
    };
    script.onerror = () => {
      checkoutPromise = null;
      reject(new Error('Failed to load Razorpay Checkout — check your connection and try again.'));
    };
  });

  return checkoutPromise;
}

export interface OpenRazorpayCheckoutParams {
  /** Server-returned key_id only */
  keyId: string;
  /** Server-returned order_id only */
  orderId: string;
  /** Server-returned amount (paise) only */
  amountPaise: number;
  currency: string;
  name?: string;
  description?: string;
  /** Optional Checkout prefill — never used as amount authority */
  prefill?: { name?: string; email?: string; contact?: string };
  onSuccess: (response: RazorpayCheckoutSuccess) => void;
  onDismiss: () => void;
  onFailure: (response: RazorpayCheckoutFailure) => void;
}

/**
 * Opens hosted Checkout with server-frozen order params only.
 */
export async function openRazorpayCheckout(params: OpenRazorpayCheckoutParams): Promise<void> {
  await loadRazorpayCheckout();
  if (!window.Razorpay) {
    throw new Error('Razorpay Checkout unavailable');
  }
  if (!params.keyId || !params.orderId || !Number.isFinite(params.amountPaise)) {
    throw new Error('Incomplete checkout session from server');
  }

  const rzp = new window.Razorpay({
    key: params.keyId,
    amount: params.amountPaise,
    currency: params.currency || 'INR',
    order_id: params.orderId,
    name: params.name || 'Registration',
    description: params.description || 'Complete payment to confirm your booking',
    prefill: params.prefill || undefined,
    handler: (response: RazorpayCheckoutSuccess) => {
      params.onSuccess(response);
    },
    modal: {
      ondismiss: () => {
        params.onDismiss();
      },
    },
  });

  rzp.on('payment.failed', (response) => {
    params.onFailure(response);
  });

  rzp.open();
}
