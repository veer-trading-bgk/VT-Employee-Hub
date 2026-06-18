export function formatCurrency(value: number | null | undefined): string {
  const n = value ?? 0;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toLocaleString('en-IN')}`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-IN');
}

export function formatPercent(value: number, decimals = 0): string {
  return `${value.toFixed(decimals)}%`;
}

export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function formatDate(date: Date | string, style: 'short' | 'long' = 'short'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (style === 'long') return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function getTrendLabel(pct: number): string {
  if (pct > 5) return '↑ Strong';
  if (pct > 0) return '↑ Up';
  if (pct === 0) return '→ Flat';
  if (pct > -5) return '↓ Down';
  return '↓ Weak';
}
