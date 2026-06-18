'use client';

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface ProgressBarChartProps {
  data: { label: string; progress: number; color: string }[];
}

export function ProgressBarChart({ data }: ProgressBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-800" />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} unit="%" />
        <Tooltip
          contentStyle={{ borderRadius: 8, border: 'none', fontSize: 12 }}
          formatter={(value) => [`${value}%`, 'Progress']}
        />
        <Bar dataKey="progress" radius={[6, 6, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
