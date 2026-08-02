'use client';

/**
 * Polls the read-only public payment-status endpoint until paid / terminal /
 * timeout / abort. Checkout.js success must NOT complete the journey UI — only 'paid'.
 */

export type PaymentPollOutcome =
  | { kind: 'paid'; status: string }
  | { kind: 'terminal'; status: string }
  | { kind: 'timeout' }
  | { kind: 'aborted' }
  | { kind: 'error'; message: string };

const TERMINAL_NON_SUCCESS = new Set(['paid_duplicate', 'failed', 'refunded']);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function pollPaymentStatus(opts: {
  url: string;
  /** Total wait before slow-confirm messaging */
  timeoutMs?: number;
  intervalMs?: number;
  /** Abort on unmount / navigation — stops timers and further fetches */
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}): Promise<PaymentPollOutcome> {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const intervalMs = opts.intervalMs ?? 1_500;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleepImpl = opts.sleep ?? sleep;
  const signal = opts.signal;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (signal?.aborted) return { kind: 'aborted' };

    try {
      const res = await fetchImpl(opts.url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      });
      if (signal?.aborted) return { kind: 'aborted' };
      if (res.status === 404) {
        return { kind: 'error', message: 'Payment not found' };
      }
      if (!res.ok) {
        // Transient — keep polling until timeout
      } else {
        const body = await res.json() as { status?: string };
        const status = body.status;
        if (status === 'paid') return { kind: 'paid', status };
        if (status && TERMINAL_NON_SUCCESS.has(status)) {
          return { kind: 'terminal', status };
        }
      }
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        return { kind: 'aborted' };
      }
      // Network blip — keep polling
    }

    try {
      await sleepImpl(intervalMs, signal);
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        return { kind: 'aborted' };
      }
      throw err;
    }
  }

  if (signal?.aborted) return { kind: 'aborted' };
  return { kind: 'timeout' };
}
