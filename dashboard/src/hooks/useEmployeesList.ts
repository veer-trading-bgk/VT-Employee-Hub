'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

// Canonical employee shape returned by /api/admin/employees
export interface EmployeeItem {
  id: string;
  name: string;
  role: string;
  email?: string;
  status?: string;
}

// Backend returns { success, data: [...] } — some older V3 pages
// incorrectly type it as { employees: [...] }; this hook normalises it.
interface ApiResponse {
  success?: boolean;
  data?: EmployeeItem[];
  employees?: EmployeeItem[];  // safety net for shape mismatch
}

// Roles that can be assigned leads.
// Mirrors the filter used in CrmTab.tsx — admins/owners manage the system,
// they are never the leaf "owner" of a lead in the sales workflow.
const ASSIGNABLE_ROLES = new Set([
  'telecaller',
  'agent',
  'intern',
  'team_lead',
  'manager',
  'admin',       // admins may also carry a book of business
  'superadmin',  // just in case
]);

// Single canonical query key used by ALL modules that need the employees list.
// Replacing the three historical keys: 'admin-employees', 'v3-employees', 'employees-list'.
export const EMPLOYEES_QUERY_KEY = ['employees-list'] as const;

export function useEmployeesList(options?: { enabled?: boolean; assignableOnly?: boolean }) {
  const { enabled = true, assignableOnly = true } = options ?? {};

  const query = useQuery<EmployeeItem[]>({
    queryKey: EMPLOYEES_QUERY_KEY,
    queryFn: async () => {
      const res = await apiFetch<ApiResponse>('/api/admin/employees');
      // Normalise both response shapes the backend may return
      const raw = res.data ?? res.employees ?? [];
      return assignableOnly ? raw.filter((e) => ASSIGNABLE_ROLES.has(e.role)) : raw;
    },
    enabled,
    staleTime: 5 * 60_000,  // employee list changes infrequently
    gcTime: 10 * 60_000,
  });

  return {
    employees: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
