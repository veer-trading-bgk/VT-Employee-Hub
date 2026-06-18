export function today(): string {
  return new Date().toISOString().split('T')[0];
}

export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

export function daysLeftInMonth(): number {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return lastDay - now.getDate();
}

export function currentMonthLabel(): string {
  return new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export function dateRangeLabel(from: string, to: string): string {
  const f = new Date(from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const t = new Date(to).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${f} – ${t}`;
}

export function generateDateRange(days: number): string[] {
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    dates.push(daysAgo(i));
  }
  return dates;
}
