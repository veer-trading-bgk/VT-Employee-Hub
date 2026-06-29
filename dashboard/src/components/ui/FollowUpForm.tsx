'use client';

import { useState } from 'react';

const inputCls =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none ' +
  'transition focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 ' +
  'dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-indigo-500';

interface FollowUpFormProps {
  onSubmit: (data: { date: string; note: string }, reset: () => void) => void;
  isLoading?: boolean;
  minDate?: string;
  placeholder?: string;
  label?: string;
}

export function FollowUpForm({
  onSubmit,
  isLoading = false,
  minDate,
  placeholder = 'Note or reminder…',
  label = 'Schedule New',
}: FollowUpFormProps) {
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');

  function reset() {
    setDate('');
    setNote('');
  }

  function handleSubmit() {
    if (!date) return;
    onSubmit({ date, note }, reset);
  }

  return (
    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
      {label && (
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          {label}
        </p>
      )}
      <div className="flex gap-2">
        <input
          type="date"
          value={date}
          min={minDate}
          onChange={(e) => setDate(e.target.value)}
          className={`${inputCls} flex-shrink-0`}
          style={{ width: '140px' }}
          aria-label="Follow-up date"
        />
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={placeholder}
          className={`${inputCls} flex-1`}
          aria-label="Follow-up note"
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
        />
        <button
          onClick={handleSubmit}
          disabled={isLoading || !date}
          className="flex-shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
        >
          {isLoading ? '…' : 'Add'}
        </button>
      </div>
    </div>
  );
}
