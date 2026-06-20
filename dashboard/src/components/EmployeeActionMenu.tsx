'use client';

import { useState, useRef, useEffect } from 'react';

interface Props {
  isActive: boolean;
  isToggling: boolean;
  totpEnabled: boolean;
  isSelf: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onResetPwd: () => void;
  onToggleStatus: () => void;
  on2FA: () => void;
  onReport: () => void;
}

export function EmployeeActionMenu({
  isActive, isToggling, totpEnabled, isSelf,
  onEdit, onDelete, onResetPwd, onToggleStatus, on2FA, onReport,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  const run = (fn: () => void) => { fn(); setOpen(false); };

  return (
    <div ref={ref}>
      {/* Desktop: inline text links (unchanged appearance) */}
      <div className="hidden items-center gap-3 md:flex">
        <button onClick={onEdit} className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">Edit</button>
        {!isSelf && (
          isActive ? (
            <button onClick={onToggleStatus} disabled={isToggling} className="text-xs font-medium text-amber-600 hover:underline disabled:opacity-40 dark:text-amber-400">
              {isToggling ? '…' : 'Deactivate'}
            </button>
          ) : (
            <button onClick={onToggleStatus} disabled={isToggling} className="text-xs font-medium text-emerald-600 hover:underline disabled:opacity-40 dark:text-emerald-400">
              {isToggling ? '…' : 'Activate'}
            </button>
          )
        )}
        {!isSelf && <button onClick={onDelete} className="text-xs font-medium text-red-500 hover:underline dark:text-red-400">Delete</button>}
        <button onClick={onResetPwd} className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400">Reset Pwd</button>
        <span className="text-slate-200 dark:text-slate-700">|</span>
        <button onClick={on2FA} className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400">
          {totpEnabled ? 'Reset 2FA' : 'Enable 2FA'}
        </button>
        <span className="text-slate-200 dark:text-slate-700">|</span>
        <button onClick={onReport} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">Report</button>
      </div>

      {/* Mobile: kebab ⋯ dropdown */}
      <div className="relative md:hidden">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex h-9 w-9 items-center justify-center rounded-md text-xl text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          aria-label="Row actions"
          aria-expanded={open}
        >
          ⋯
        </button>

        {open && (
          <div className="absolute right-0 top-10 z-50 min-w-[11rem] rounded-lg border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <button onClick={() => run(onEdit)} className="flex w-full items-center px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800">
              Edit
            </button>
            {!isSelf && (
              <button onClick={() => run(onToggleStatus)} disabled={isToggling} className={`flex w-full items-center px-4 py-3 text-sm disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 ${isActive ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {isActive ? 'Deactivate' : 'Activate'}
              </button>
            )}
            <button onClick={() => run(onResetPwd)} className="flex w-full items-center px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800">
              Reset Password
            </button>
            <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
            <button onClick={() => run(on2FA)} className="flex w-full items-center px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800">
              {totpEnabled ? 'Reset 2FA' : 'Enable 2FA'}
            </button>
            <button onClick={() => run(onReport)} className="flex w-full items-center px-4 py-3 text-sm text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/20">
              Performance Report
            </button>
            {!isSelf && (
              <>
                <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                <button onClick={() => run(onDelete)} className="flex w-full items-center px-4 py-3 text-sm text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/20">
                  Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
