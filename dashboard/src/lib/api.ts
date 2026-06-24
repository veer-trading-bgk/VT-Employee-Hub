const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export class ApiClientError extends Error {
  status: number;
  body?: Record<string, unknown>;
  constructor(message: string, status: number, body?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.body = body;
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
        let errorBody: Record<string, unknown> | undefined;
        try {
          errorBody = await res.json() as Record<string, unknown>;
          message = (errorBody.error as string) || message;
        } catch { /* non-JSON body */ }
        throw new ApiClientError(message, res.status, errorBody);
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
  leaderboard: () => apiFetch('/api/metrics/leaderboard'),
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
    apiFetch<{ success: true; message: string; employee: { id: string; name: string; email: string }; metricsDeleted: number }>(`/api/admin/employees/${id}`, {
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

  // ── Verification ────────────────────────────────────────────────────────────
  pendingMetrics: () =>
    apiFetch<PendingMetricsResponse>('/api/metrics/pending'),

  verifyMetric: (metricId: string, approved: boolean, notes?: string) =>
    apiFetch<{ success: true }>('/api/metrics/verify', {
      method: 'POST',
      body: JSON.stringify({ metricId, approved, notes }),
      retries: 0,
    }),

  // ── Audit ───────────────────────────────────────────────────────────────────
  auditLogs: (hours = 24, limit = 500) =>
    apiFetch<AuditLogsResponse>(`/api/audit/logs?hours=${hours}&limit=${limit}`),

  suspiciousActivity: () =>
    apiFetch<SuspiciousActivityResponse>('/api/audit/suspicious'),

  securityReport: () =>
    apiFetch<SecurityReportResponse>('/api/audit/security-report'),

  // ── Compensation ────────────────────────────────────────────────────────────
  payroll: () =>
    apiFetch<PayrollResponse>('/api/compensation/payroll'),

  employeeCompensation: (userId: string) =>
    apiFetch<EmployeeCompensationResponse>(`/api/compensation/calculate/${userId}`),

  // ── Bulk employee operations ─────────────────────────────────────────────────
  bulkStatusUpdate: (ids: string[], status: 'active' | 'inactive') =>
    apiFetch<BulkOperationResponse>('/api/admin/employees/bulk-status', {
      method: 'POST',
      body: JSON.stringify({ ids, status }),
      retries: 0,
    }),

  bulkDeleteEmployees: (ids: string[]) =>
    apiFetch<BulkOperationResponse>('/api/admin/employees/bulk', {
      method: 'DELETE',
      body: JSON.stringify({ ids }),
      retries: 0,
    }),

  // ── Per-employee metrics ─────────────────────────────────────────────────────
  employeeMetrics: (userId: string, days = 30) =>
    apiFetch<EmployeeMetricsResponse>(`/api/admin/employees/${userId}/metrics?days=${days}`),

  // ── Platform (superadmin) ─────────────────────────────────────────────────
  platformStats: () =>
    apiFetch<PlatformStatsResponse>('/api/platform/stats'),

  platformCompanies: () =>
    apiFetch<PlatformCompaniesResponse>('/api/platform/companies'),

  platformCompany: (companyId: string) =>
    apiFetch<PlatformCompanyDetailResponse>(`/api/platform/companies/${companyId}`),

  platformUpdatePlan: (companyId: string, data: { plan?: string; planStatus?: string; trialEndsAt?: string }) =>
    apiFetch<{ success: boolean; companyId: string; plan?: string; planStatus?: string; trialEndsAt?: string }>(
      `/api/platform/companies/${companyId}/plan`,
      { method: 'PUT', body: JSON.stringify(data), retries: 0 }
    ),

  platformUnsuspend: (companyId: string) =>
    apiFetch<{ success: boolean; companyId: string; planStatus: string }>(
      `/api/platform/companies/${companyId}/unsuspend`,
      { method: 'POST', retries: 0 }
    ),

  companyOnboarding: () =>
    apiFetch<OnboardingResponse>('/api/companies/onboarding'),

  companyExport: () =>
    apiFetch<Record<string, unknown>>('/api/companies/export'),
};

// ── Response types for new endpoints ─────────────────────────────────────────

export interface PendingMetric {
  PK: string;
  SK: string;
  metricId: string;
  userId: string;
  metric_type: string;
  value: number;
  date: string;
  enteredAt?: string;
  enteredFrom?: string;
  verified: boolean;
  verificationStatus: string;
  flagged?: boolean;
  verificationNotes?: string;
}

export interface PendingMetricsResponse {
  data: PendingMetric[];
  total: number;
}

export interface AuditEntry {
  pk?: string;
  sk?: string;
  action: string;
  userId?: string;
  adminId?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  timestamp?: string;
  suspicious?: boolean;
}

export interface AuditLogsResponse {
  success: boolean;
  logs: AuditEntry[];
  count: number;
}

export interface SuspiciousActivityResponse {
  success: boolean;
  summary: {
    totalEvents: number;
    failedLogins: number;
    suspiciousEntries: number;
    deletions: number;
  };
  events: AuditEntry[];
}

export interface SecurityReportResponse {
  success: boolean;
  report: {
    period: string;
    stats: Record<string, number>;
    highRiskIps: string[];
    recommendations: string[];
  };
}

export interface PayrollEntry {
  userId: string;
  base: number;
  bonus: number;
  total: number;
  metrics: Record<string, number>;
}

export interface PayrollResponse {
  success?: boolean;
  month: string;
  count: number;
  payroll: PayrollEntry[];
}

export interface EmployeeCompensationResponse {
  month: number;
  year: number;
  breakdown: Record<string, { count: number; rate: number; amount: number }>;
  baseCompensation: number;
  performanceBonus: number;
  totalCompensation: number;
}

export interface BulkOperationResponse {
  success: boolean;
  succeeded: number;
  failed: number;
  errors?: string[];
}

export interface EmployeeMetricsResponse {
  success: boolean;
  employee: { id: string; name: string; email: string };
  data: Record<string, Record<string, number>>;
  totalRecords: number;
}

export interface PlatformCompany {
  id: string;
  companyId: string;
  companyName: string;
  broker?: string;
  city?: string;
  adminEmail?: string;
  plan: string;
  planStatus: string;
  trialEndsAt?: string | null;
  createdAt?: string;
  daysLeftInTrial?: number | null;
}

export interface PlatformStats {
  totalCompanies: number;
  active: number;
  onTrial: number;
  trialExpired: number;
  suspended: number;
}

export interface PlatformStatsResponse {
  success: boolean;
  stats: PlatformStats;
  generatedAt: string;
}

export interface PlatformCompaniesResponse {
  success: boolean;
  total: number;
  companies: PlatformCompany[];
}

export interface PlatformCompanyDetailResponse {
  success: boolean;
  company: PlatformCompany & Record<string, unknown>;
  stats: { employeeCount: number; leadCount: number };
}

export interface OnboardingStep {
  id: string;
  label: string;
  complete: boolean;
}

export interface OnboardingResponse {
  success: boolean;
  progress: { completed: number; total: number; percent: number };
  steps: OnboardingStep[];
  allDone: boolean;
  company?: { companyName: string; plan: string; planStatus: string; trialEndsAt?: string };
}
