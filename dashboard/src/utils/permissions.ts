import type { Role } from '@/types';

const ROLE_HIERARCHY: Record<Role, number> = {
  superadmin: 10,
  admin: 5,
  manager: 4,
  team_lead: 3,
  agent: 1,
  telecaller: 1,
  intern: 1,
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

export function isTeamLead(role: Role): boolean {
  return role === 'team_lead' || isManager(role);
}

export function isEmployee(role: Role): boolean {
  return ['agent', 'telecaller', 'intern'].includes(role);
}

export function getHomePath(role: Role): string {
  switch (role) {
    case 'superadmin': return '/platform';
    case 'admin':      return '/admin/dashboard';
    case 'manager':    return '/manager/dashboard';
    case 'team_lead':  return '/team-lead/dashboard';
    default:           return '/employee/dashboard';
  }
}

export const ROLE_LABELS: Record<Role, string> = {
  superadmin: 'Platform Admin',
  admin:      'Administrator',
  manager:    'Manager',
  team_lead:  'Team Lead',
  agent:      'Agent',
  telecaller: 'Telecaller',
  intern:     'Intern',
};

export const ROLE_COLORS: Record<Role, string> = {
  superadmin: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  admin:      'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  manager:    'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  team_lead:  'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  agent:      'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  telecaller: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  intern:     'bg-slate-500/10 text-slate-600 dark:text-slate-400',
};
