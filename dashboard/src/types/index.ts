export type Role = 'admin' | 'manager' | 'team_lead' | 'agent' | 'telecaller' | 'intern';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface MetricRecord {
  PK: string;
  SK: string;
  metricId: string;
  userId: string;
  metric_type: string;
  value: number;
  date: string; // YYYY-MM-DD
  enteredAt: string;
  enteredFrom: string;
  verified: boolean;
}

export interface MyMetricsResponse {
  success: boolean;
  /** Keyed by date string (YYYY-MM-DD), then by metric_type → numeric value */
  data: Record<string, Record<string, number>>;
  targets: Record<string, number>;
  totalRecords: number;
}

export interface AllMetricsResponse {
  success: boolean;
  data: MetricRecord[];
  totalRecords: number;
}

export interface TeamSummaryEntry {
  email: string;
  metrics: Record<string, number>;
  [progressKey: string]: unknown;
}

export interface TeamSummaryResponse {
  success: boolean;
  date: string;
  data: Record<string, TeamSummaryEntry>;
  targets: Record<string, number>;
}

export interface ApiError {
  error: string;
}
