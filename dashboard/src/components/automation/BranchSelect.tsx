'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { selectCls } from './ActionEditor';

export interface Branch {
  branchId:  string;
  name:      string;
  address?:  string;
  latitude:  number;
  longitude: number;
}

interface BranchSelectProps {
  value:    string;
  onChange: (branchId: string) => void;
}

/**
 * Shared branch dropdown — the Send Location canvas node's config and the
 * Inbox composer's own "Send Location" button both pick from this same
 * CONFIG#BRANCH# list (Settings > WhatsApp > Branches owns the CRUD).
 */
export function BranchSelect({ value, onChange }: BranchSelectProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['wa-branches'],
    queryFn: () => apiFetch<{ branches: Branch[] }>('/api/whatsapp/branches'),
    staleTime: 60_000,
  });
  const branches = data?.branches ?? [];

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={selectCls}>
      <option value="">{isLoading ? 'Loading branches…' : branches.length ? 'Select a branch…' : 'No branches saved yet'}</option>
      {branches.map((b) => (
        <option key={b.branchId} value={b.branchId}>{b.name}</option>
      ))}
    </select>
  );
}
