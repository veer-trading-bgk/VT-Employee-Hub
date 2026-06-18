export type EmployeeRole = 'admin' | 'manager' | 'team_lead' | 'telecaller';
export type EmployeeStatus = 'active' | 'inactive' | 'suspended';

export interface Employee {
  id: string;
  name: string;
  email: string;
  role: EmployeeRole;
  status: EmployeeStatus;
  telegramChatId?: string;
  createdAt: string;
  createdBy?: string;
}

export interface EmployeeWithMetrics extends Employee {
  todayKyc?: number;
  todayDemat?: number;
  todayMf?: number;
  todayInsurance?: number;
  monthlyScore?: number;
  performancePct?: number;
}

export interface LeaderboardEntry {
  rank: number;
  employee: Employee;
  points: number;
  kyc: number;
  demat: number;
  mf: number;
  insurance: number;
  trend: 'up' | 'down' | 'stable';
}

export interface TeamSummary {
  totalEmployees: number;
  activeEmployees: number;
  avgPerformance: number;
  topPerformer?: Employee;
  atRisk: Employee[];
}

export interface AdminStats {
  totalEmployees: number;
  activeEmployees: number;
  targetsHitPct: number;
  newThisMonth: number;
  leaderboard: LeaderboardEntry[];
  departmentBreakdown: { dept: string; count: number; avgScore: number }[];
}
