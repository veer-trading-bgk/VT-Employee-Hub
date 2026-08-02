'use strict';

/**
 * Mirrors dashboard/src/lib/journeys/pollPaymentStatus.ts behaviour for Jest
 * (dashboard TS not loaded by root Jest). Keep in sync when changing poll rules.
 */

const TERMINAL_NON_SUCCESS = new Set(['paid_duplicate', 'failed', 'refunded']);

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function pollPaymentStatus(opts) {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const intervalMs = opts.intervalMs ?? 1_500;
  const fetchImpl = opts.fetchImpl;
  const sleepImpl = opts.sleep ?? sleep;
  const signal = opts.signal;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (signal?.aborted) return { kind: 'aborted' };
    try {
      const res = await fetchImpl(opts.url, { method: 'GET', signal });
      if (signal?.aborted) return { kind: 'aborted' };
      if (res.status === 404) return { kind: 'error', message: 'Payment not found' };
      if (res.ok) {
        const body = await res.json();
        if (body.status === 'paid') return { kind: 'paid', status: body.status };
        if (body.status && TERMINAL_NON_SUCCESS.has(body.status)) {
          return { kind: 'terminal', status: body.status };
        }
      }
    } catch (err) {
      if (signal?.aborted || err?.name === 'AbortError') return { kind: 'aborted' };
    }
    try {
      await sleepImpl(intervalMs, signal);
    } catch (err) {
      if (signal?.aborted || err?.name === 'AbortError') return { kind: 'aborted' };
      throw err;
    }
  }
  if (signal?.aborted) return { kind: 'aborted' };
  return { kind: 'timeout' };
}

describe('pollPaymentStatus (parity)', () => {
  test('resolves paid after pending polls — never treats first tick as done', async () => {
    let n = 0;
    const fetchImpl = jest.fn(async () => {
      n += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: n >= 3 ? 'paid' : 'pending' }),
      };
    });
    const outcome = await pollPaymentStatus({
      url: 'http://test/pay',
      timeoutMs: 10_000,
      intervalMs: 0,
      fetchImpl,
      sleep: async () => {},
    });
    expect(outcome).toEqual({ kind: 'paid', status: 'paid' });
    expect(n).toBeGreaterThanOrEqual(3);
  });

  test('stops on paid_duplicate / failed terminal statuses', async () => {
    for (const status of ['paid_duplicate', 'failed', 'refunded']) {
      const outcome = await pollPaymentStatus({
        url: 'http://test/pay',
        timeoutMs: 5_000,
        intervalMs: 0,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ status }),
        }),
        sleep: async () => {},
      });
      expect(outcome).toEqual({ kind: 'terminal', status });
    }
  });

  test('abort signal stops polling and clears further fetches', async () => {
    const ac = new AbortController();
    let fetches = 0;
    const fetchImpl = jest.fn(async () => {
      fetches += 1;
      if (fetches === 1) ac.abort();
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'pending' }),
      };
    });
    const outcome = await pollPaymentStatus({
      url: 'http://test/pay',
      timeoutMs: 60_000,
      intervalMs: 10,
      signal: ac.signal,
      fetchImpl,
      sleep,
    });
    expect(outcome).toEqual({ kind: 'aborted' });
    expect(fetches).toBe(1);
  });

  test('timeout when never paid', async () => {
    const now = Date.now();
    let t = now;
    jest.spyOn(Date, 'now').mockImplementation(() => t);
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'pending' }),
    }));
    const sleepFn = jest.fn(async () => { t += 20_000; });
    const outcome = await pollPaymentStatus({
      url: 'http://test/pay',
      timeoutMs: 45_000,
      intervalMs: 1,
      fetchImpl,
      sleep: sleepFn,
    });
    expect(outcome).toEqual({ kind: 'timeout' });
    Date.now.mockRestore();
  });
});
