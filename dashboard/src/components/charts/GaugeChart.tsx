'use client';

import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';

interface GaugeChartProps {
  /** 0-100+ */
  value: number;
  label: string;
}

export function GaugeChart({ value, label }: GaugeChartProps) {
  const clamped = Math.min(Math.max(value, 0), 100);
  const data = [
    { name: 'filled', value: clamped },
    { name: 'empty', value: 100 - clamped }
  ];
  const color = clamped >= 100 ? '#22c55e' : clamped >= 60 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative flex flex-col items-center">
      <ResponsiveContainer width="100%" height={160}>
        <PieChart>
          <Pie
            data={data}
            startAngle={180}
            endAngle={0}
            innerRadius="70%"
            outerRadius="100%"
            dataKey="value"
            stroke="none"
          >
            <Cell fill={color} />
            <Cell fill="#e2e8f0" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute top-[58%] flex flex-col items-center">
        <span className="text-2xl font-bold text-slate-900 dark:text-white">{Math.round(value)}%</span>
        <span className="text-xs text-slate-400">{label}</span>
      </div>
    </div>
  );
}
