const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export class ApiClientError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiClientError';
  }
}

// In-memory token — set on login, cleared on logout.
// Used as Bearer header so auth works even when cross-origin cookies are blocked.
let _memToken: string | null = null;
export const setMemoryToken = (t: string | null) => { _memToken = t; };
export const getMemoryToken = () => _memToken;

interface RequestOptions extends RequestInit {
  retries?: number;
  retryDelayMs?: number;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { retries = 2, retryDelayMs = 500, ...init } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const extraHeaders: Record<string, string> = _memToken
        ? { Authorization: `Bearer ${_memToken}` }
        : {};

      const res = await fetch(`${API_URL}${path}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...extraHeaders, ...init.headers },
        ...init,
      });

      if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try {
          const body = await res.json();
          message = body.error || message;
        } catch { /* non-JSON body */ }
        throw new ApiClientError(message, res.status);
      }

      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      const isClientError = err instanceof ApiClientError && err.status < 500;
      if (isClientError || attempt === retries) break;
      await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
    }
  }

  throw lastError;
}

// ── Typed response shapes ─────────────────────────────────────────────────────

export interface UserShape {
  id: string;
  email: string;
  role: string;
  name: string;
}

export type LoginResponse =
  | { success: true; user: UserShape; token: string; gracePeriodDaysRemaining?: number }
  | { requiresTOTP: true; tempToken: string; message: string };

export interface TotpVerifyResponse {
  success: true;
  user: UserShape;
  token: string;
  backupCodesRemaining?: number;
  warning?: string;
}

export interface Setup2FAResponse {
  success: true;
  qrCode: string;
  manualEntryKey: string;
  backupCodes: string[];
  message: string;
}

// ── API client ────────────────────────────────────────────────────────────────

export const api = {
  login: (email: string, password: string) =>
    apiFetch<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      retries: 0,
    }),

  verifyTotp: (tempToken: string, totpCode: string) =>
    apiFetch<TotpVerifyResponse>('/api/auth/verify-totp', {
      method: 'POST',
      body: JSON.stringify({ tempToken, totpCode }),
      retries: 0,
    }),

  verifyBackupCode: (tempToken: string, email: string, backupCode: string) =>
    apiFetch<TotpVerifyResponse>('/api/auth/verify-totp-backup', {
      method: 'POST',
      body: JSON.stringify({ tempToken, email, backupCode }),
      retries: 0,
    }),

  logout: () => apiFetch('/api/auth/logout', { method: 'POST', retries: 0 }),

  me: () => apiFetch<UserShape>('/api/auth/me'),

  myMetrics: (days = 30) => apiFetch(`/api/metrics/my?days=${days}`),
  allMetrics: (days = 30) => apiFetch(`/api/metrics/all?days=${days}`),
  teamSummary: () => apiFetch('/api/metrics/team-summary'),
  addMetric: (metric_type: string, value: number) =>
    apiFetch('/api/metrics/add', {
      method: 'POST',
      body: JSON.stringify({ metric_type, value }),
      retries: 0,
    }),

  updateEmployee: (id: string, data: { name?: string; email?: string; role?: string; status?: string }) =>
    apiFetch<{ success: true; employee: Record<string, unknown> }>(`/api/admin/employees/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
      retries: 0,
    }),

  deleteEmployee: (id: string) =>
    apiFetch<{ success: true; message: string; employee: { id: string; name: string; email: string; status: string } }>(`/api/admin/employees/${id}`, {
      method: 'DELETE',
      retries: 0,
    }),

  resetPassword: (id: string, newPassword: string) =>
    apiFetch<{ success: true; message: string }>(`/api/admin/employees/${id}/reset-password`, {
      method: 'PUT',
      body: JSON.stringify({ newPassword }),
      retries: 0,
    }),

  setup2fa: (userId: string) =>
    apiFetch<Setup2FAResponse>(`/api/admin/employees/${userId}/setup-2fa`, {
      method: 'POST',
      retries: 0,
    }),

  reset2fa: (userId: string) =>
    apiFetch<{ success: true; message: string }>(`/api/admin/employees/${userId}/2fa`, {
      method: 'DELETE',
      retries: 0,
    }),
};
