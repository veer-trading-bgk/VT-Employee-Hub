import type { Role } from '@/types';

const ROLE_HIERARCHY: Record<Role, number> = {
  admin: 4,
  manager: 3,
  telecaller: 1,
};

export function hasRole(userRole: Role, required: Role): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[required];
}

export function isAdmin(role: Role): boolean {
  return role === 'admin';
}

export function isManager(role: Role): boolean {
  return role === 'manager' || role === 'admin';
}

export function getHomePath(role: Role): string {
  switch (role) {
    case 'admin': return '/admin/dashboard';
    case 'manager': return '/manager/dashboard';
    default: return '/dashboard';
  }
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrator',
  manager: 'Manager',
  telecaller: 'Telecaller',
};

export const ROLE_COLORS: Record<Role, string> = {
  admin: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  manager: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  telecaller: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
};
