'use client';

import { getMemoryToken } from '@/lib/api';

export type WsMessage = { event: string; [key: string]: unknown };
type WsHandler = (msg: WsMessage) => void;

/**
 * Granular WebSocket connection states.
 * Exposed via WsContextValue so UI can show meaningful connection indicators.
 *
 * idle        — not connected, not trying (logged-out or before first connect)
 * connecting  — opening socket for the first time (no prior successful session)
 * connected   — socket is OPEN and healthy
 * reconnecting— re-opening after a disconnect (there was at least one prior session)
 * offline     — browser reports navigator.onLine = false
 * error       — auth failure (JWT rejected by $connect); user intervention needed
 */
export type WsConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline'
  | 'error';

class WsClient {
  private ws: WebSocket | null = null;
  private baseUrl: string | null = null;
  private readonly handlers = new Map<string, Set<WsHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1_000;
  private readonly MAX_BACKOFF = 30_000;
  private destroyed = false;
  private refreshFn: (() => Promise<void>) | null = null;

  // ── Connection state machine ──────────────────────────────────────────────
  private _state: WsConnectionState = 'idle';
  private _lastConnectedAt: number | null = null;
  private _everConnected = false;
  private _windowListenersAdded = false;

  // ─────────────────────────────────────────────────────────────────────────

  private _setState(state: WsConnectionState): void {
    if (this._state === state) return; // no-op on same state
    this._state = state;
    this._emit({ event: '$state', state, lastConnectedAt: this._lastConnectedAt });
  }

  /**
   * Wire window online/offline events the first time connect() is called.
   * Guarded against SSR environments where window is undefined.
   */
  private _initWindowListeners(): void {
    if (this._windowListenersAdded || typeof window === 'undefined') return;
    this._windowListenersAdded = true;
    window.addEventListener('offline', () => {
      if (this._state !== 'idle' && this._state !== 'error') this._setState('offline');
    });
    window.addEventListener('online', () => {
      if (this._state === 'offline') this.reconnect();
    });
  }

  setRefreshFn(fn: (() => Promise<void>) | null): void {
    this.refreshFn = fn;
  }

  private _isTokenExpired(token: string): boolean {
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now() + 10_000;
    } catch {
      return false;
    }
  }

  connect(url: string): void {
    const token = getMemoryToken();
    if (!token) return;

    this._initWindowListeners();

    // Strip non-printable ASCII (BOM, Private Use Area chars from UTF-16 env file encoding bugs).
    const safeUrl = url.replace(/[^\x20-\x7E]/g, '').trim();
    if (safeUrl !== url) {
      console.warn('[wsClient] NEXT_PUBLIC_WS_URL had non-printable chars; stripped', {
        original: JSON.stringify(url),
        sanitized: safeUrl,
      });
    }

    // Already connected/connecting to this base URL — skip
    if (
      this.baseUrl === safeUrl &&
      this.ws &&
      this.ws.readyState !== WebSocket.CLOSED &&
      !this.destroyed
    ) {
      return;
    }

    // Tear down any existing socket before opening a new one
    this.destroyed = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.ws?.close();
    this.ws = null;

    this.baseUrl = safeUrl;
    this.destroyed = false;
    void this._open();
  }

  private async _open(): Promise<void> {
    if (!this.baseUrl || this.destroyed) return;

    // Emit connecting vs. reconnecting based on session history
    this._setState(this._everConnected ? 'reconnecting' : 'connecting');

    let raw = getMemoryToken();
    if (!raw) return;

    // Refresh token before connecting if it is about to expire.
    if (this._isTokenExpired(raw) && this.refreshFn) {
      try {
        await this.refreshFn();
      } catch {
        console.warn('[wsClient] token refresh failed — stopping reconnect loop');
        this._setState('error');
        return;
      }
      if (this.destroyed) return;
      raw = getMemoryToken();
      if (!raw) return;
    }

    const token = String(raw).replace(/[^A-Za-z0-9\-_.]/g, '');
    if (!token) {
      console.warn('[wsClient] token empty after sanitization — skipping connect');
      this._setState('error');
      return;
    }
    if (token !== raw) {
      console.warn('[wsClient] token contained non-JWT characters; they were stripped', {
        originalLength: raw.length,
        sanitizedLength: token.length,
      });
    }

    const url = `${this.baseUrl}?token=${token}`;
    try {
      this.ws = new WebSocket(url);
    } catch {
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.backoff = 1_000;
      this._everConnected = true;
      this._lastConnectedAt = Date.now();
      this._setState('connected');
      this._emit({ event: '$open' });
    };

    this.ws.onmessage = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(String(ev.data)) as WsMessage;
        if (typeof msg.event !== 'string') return;
        this._emit(msg);
      } catch {
        // non-JSON frame — ignore
      }
    };

    this.ws.onclose = () => {
      this._emit({ event: '$close' });
      if (!this.destroyed) {
        this._setState('reconnecting');
        this._scheduleReconnect();
      } else {
        this._setState('idle');
      }
    };

    this.ws.onerror = () => {
      // onerror is always followed by onclose — let onclose drive reconnect
      this.ws?.close();
    };
  }

  private _emit(msg: WsMessage): void {
    this.handlers.get(msg.event)?.forEach((h) => h(msg));
    // wildcard handlers receive every event including $open/$close/$state
    this.handlers.get('*')?.forEach((h) => h(msg));
  }

  private _scheduleReconnect(): void {
    if (this.reconnectTimer || this.destroyed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.backoff = Math.min(this.backoff * 2, this.MAX_BACKOFF);
      void this._open();
    }, this.backoff);
  }

  /**
   * Immediately attempt reconnect, bypassing the exponential backoff timer.
   * Resets backoff to 1 s so the next automatic retry is also fast.
   * No-ops if already connected, if destroyed, or if no baseUrl is set.
   */
  reconnect(): void {
    if (this.destroyed || !this.baseUrl) return;
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.backoff = 1_000;
    void this._open();
  }

  disconnect(): void {
    this.destroyed = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.ws?.close();
    this.ws = null;
    this.baseUrl = null;
    this._setState('idle');
  }

  on(event: string, handler: WsHandler): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: WsHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  /** Current granular connection state. */
  get state(): WsConnectionState { return this._state; }

  /** Unix timestamp (ms) of the most recent successful connection, or null. */
  get lastConnectedAt(): number | null { return this._lastConnectedAt; }

  /** True when the socket is OPEN — backward-compatible shorthand. */
  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Module-level singleton — safe because this module is 'use client' only.
export const wsClient = new WsClient();
