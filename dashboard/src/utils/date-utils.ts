const IST = 'Asia/Kolkata';

export function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: IST });
}

export function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toLocaleDateString('en-CA', { timeZone: IST });
}

export function daysLeftInMonth(): number {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return lastDay - now.getDate();
}

export function currentMonthLabel(): string {
  return new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: IST });
}

export function dateRangeLabel(from: string, to: string): string {
  const f = new Date(from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: IST });
  const t = new Date(to).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: IST });
  return `${f} – ${t}`;
}

export function generateDateRange(days: number): string[] {
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    dates.push(daysAgo(i));
  }
  return dates;
}
