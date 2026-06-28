'use client';

import { getMemoryToken } from '@/lib/api';

export type WsMessage = { event: string; [key: string]: unknown };
type WsHandler = (msg: WsMessage) => void;

class WsClient {
  private ws: WebSocket | null = null;
  private baseUrl: string | null = null; // base URL without token
  private readonly handlers = new Map<string, Set<WsHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1_000;
  private readonly MAX_BACKOFF = 30_000;
  private destroyed = false;

  connect(url: string): void {
    const token = getMemoryToken();
    if (!token) return; // no token yet — WebSocketContext will call connect() again after login

    // Strip non-printable ASCII (BOM, Private Use Area chars from UTF-16 env file encoding bugs).
    // NEXT_PUBLIC_WS_URL can arrive with invisible trailing/embedded PUA chars (%EE%81%xx)
    // when the .env file was saved as UTF-16 LE or the Vercel dashboard value has hidden chars.
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
    this._open();
  }

  private _open(): void {
    if (!this.baseUrl || this.destroyed) return;
    // Read token fresh on every open attempt — handles reconnects after token refresh
    const raw = getMemoryToken();
    if (!raw) return; // token cleared (logout in flight) — stop reconnect loop

    // JWT tokens are base64url-encoded: only A-Za-z0-9, -, _, and . are valid.
    // encodeURIComponent() on a string containing non-ASCII (e.g. Unicode PUA characters)
    // produces %EE%81%xx sequences that corrupt the URL. Sanitize instead: strip every
    // character outside the JWT alphabet, then use the token directly — no encoding needed
    // because the remaining characters are already URL-safe.
    const token = String(raw).replace(/[^A-Za-z0-9\-_.]/g, '');
    if (!token) {
      console.warn('[wsClient] token empty after sanitization — skipping connect');
      return;
    }
    if (token !== raw) {
      console.warn('[wsClient] token contained non-JWT characters; they were stripped', { originalLength: raw.length, sanitizedLength: token.length });
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
      if (!this.destroyed) this._scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onerror is always followed by onclose — let onclose drive reconnect
      this.ws?.close();
    };
  }

  private _emit(msg: WsMessage): void {
    this.handlers.get(msg.event)?.forEach((h) => h(msg));
    // wildcard handlers receive every event including $open/$close
    this.handlers.get('*')?.forEach((h) => h(msg));
  }

  private _scheduleReconnect(): void {
    if (this.reconnectTimer || this.destroyed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.backoff = Math.min(this.backoff * 2, this.MAX_BACKOFF);
      this._open();
    }, this.backoff);
  }

  disconnect(): void {
    this.destroyed = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.ws?.close();
    this.ws = null;
    this.baseUrl = null;
  }

  on(event: string, handler: WsHandler): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: WsHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Module-level singleton — safe because this module is 'use client' only.
export const wsClient = new WsClient();
