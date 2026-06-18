'use client';

const RANGES = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 }
];

export function DateRangeFilter({
  value,
  onChange
}: {
  value: number;
  onChange: (days: number) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
      {RANGES.map((r) => (
        <button
          key={r.days}
          onClick={() => onChange(r.days)}
          className={`rounded-md px-3 py-1 text-sm font-medium transition ${
            value === r.days
              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
