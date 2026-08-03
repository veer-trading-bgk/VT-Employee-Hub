import type { PlatformCompany } from '@/lib/api';

/** Calendar date YYYY-MM-DD in Asia/Kolkata (DH-00 / DH-02). */
export function istDateKey(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Count companies whose createdAt falls on today's IST calendar day. */
export function countNewCompaniesToday(
  companies: Pick<PlatformCompany, 'createdAt'>[],
  now: Date = new Date(),
): number {
  const today = istDateKey(now);
  return companies.filter((c) => c.createdAt && istDateKey(new Date(c.createdAt)) === today).length;
}

/** DH-03: human reason for Needs Attention row. */
export function attentionReason(c: PlatformCompany): string {
  if (c.planStatus === 'suspended') return 'Suspended';
  if (c.plan === 'trial') {
    const days = c.daysLeftInTrial ?? 0;
    if (days <= 0) return 'Trial expired';
    if (days === 1) return 'Trial · 1d left';
    return `Trial · ${days}d left`;
  }
  return statusFallback(c);
}

function statusFallback(c: PlatformCompany): string {
  return c.planStatus || 'Needs attention';
}
