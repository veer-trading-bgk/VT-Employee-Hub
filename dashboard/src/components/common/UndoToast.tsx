'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  message: string;
  onConfirm: () => void;
  onUndo: () => void;
  duration?: number;
}

export function UndoToast({ message, onConfirm, onUndo, duration = 5000 }: Props) {
  const [remaining, setRemaining] = useState(Math.ceil(duration / 1000));
  const confirmedRef = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => setRemaining((r) => r - 1), 1000);
    const timeout = setTimeout(() => {
      if (!confirmedRef.current) { confirmedRef.current = true; onConfirm(); }
    }, duration);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [onConfirm, duration]);

  return (
    <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg dark:border-slate-700 dark:bg-slate-800">
      <span className="text-sm text-slate-700 dark:text-slate-200">{message}</span>
      <span className="text-xs text-slate-400">{remaining}s</span>
      <button
        onClick={() => { confirmedRef.current = true; onUndo(); }}
        className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
      >
        Undo
      </button>
    </div>
  );
}
