export interface ScoredLead {
  stage: string;
  updatedAt: string;
  productInterest?: string[];
  tags?: string[];
  closureDeadline?: string;
  email?: string;
}

export function calculateScore(lead: ScoredLead, stages: { key: string }[]): number {
  let score = 0;

  // Stage depth: 0–40 pts
  const idx = stages.findIndex((s) => s.key === lead.stage);
  if (idx >= 0) score += Math.round((idx / Math.max(stages.length - 1, 1)) * 40);

  // Recency: 0–20 pts
  const daysSince = (Date.now() - new Date(lead.updatedAt).getTime()) / 86_400_000;
  if (daysSince < 3) score += 20;
  else if (daysSince < 7) score += 14;
  else if (daysSince < 30) score += 7;

  // Product interest: 5 pts each, max 20
  score += Math.min((lead.productInterest?.length ?? 0) * 5, 20);

  // Tags: 2 pts each, max 10
  score += Math.min((lead.tags?.length ?? 0) * 2, 10);

  // Deadline set: +5
  if (lead.closureDeadline) score += 5;

  // Has email: +3
  if (lead.email) score += 3;

  return Math.min(score, 100);
}

export function scoreBadge(score: number): { label: string; cls: string } {
  if (score >= 70) return { label: `🔥 ${score}`, cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' };
  if (score >= 40) return { label: `☀ ${score}`, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' };
  return { label: `❄ ${score}`, cls: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' };
}
