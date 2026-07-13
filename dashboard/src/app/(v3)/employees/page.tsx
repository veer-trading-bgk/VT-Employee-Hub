'use client';

import { RefreshCw, UserPlus, Users } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/v3/ui/Button';
import { EmployeesSection, triggerAddEmployee } from '@/components/v3/team/EmployeesSection';
import { useAuth } from '@/context/AuthContext';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';

function EmployeesPageInner() {
  const qc = useQueryClient();
  const { user } = useAuth();
  // Raw role, not v3Role (DL-021, docs/v3/12_DECISION_LOG.md: display buckets
  // must never be used for permission gating, only raw roles).
  const rawRole = user?.role;
  const canCreate = rawRole === 'superadmin' || rawRole === 'admin';

  return (
    <div className="flex h-full flex-col">
      {/* Sticky page header */}
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/30">
            <Users className="h-5 w-5 text-primary-600 dark:text-primary-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Employees</h1>
            <p className="text-xs text-neutral-500">Manage team members, roles and permissions</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => qc.invalidateQueries({ queryKey: ['v3-employees'] })}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
            aria-label="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          {canCreate && (
            <Button
              size="sm"
              iconLeft={<UserPlus className="h-4 w-4" />}
              onClick={triggerAddEmployee}
            >
              Add Employee
            </Button>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-6">
        <EmployeesSection />
      </div>
    </div>
  );
}

// Admin-only — nav already hides this (V3Sidebar's roles: ['owner','admin']),
// but that was nav-hiding only, not real route enforcement (Phase 2A audit,
// 2026-07-06). See docs/bible/19_DECISION_LOG.md's Era 24 entry.
export default function EmployeesPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <EmployeesPageInner />
    </ProtectedRoute>
  );
}
