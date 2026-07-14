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

function Ic({ d, children, size = 14 }: { d?: string; children?: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d ? <path d={d} /> : children}
    </svg>
  );
}

const IcEdit   = () => <Ic><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></Ic>;
const IcCheck  = () => <Ic><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></Ic>;
const IcPause  = () => <Ic><circle cx="12" cy="12" r="10"/><line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/></Ic>;
const IcKey    = () => <Ic><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></Ic>;
const IcShield = () => <Ic d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />;
const IcChart  = () => <Ic><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></Ic>;
const IcTrash  = () => <Ic><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></Ic>;
const IcDots   = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor" aria-hidden="true">
    <circle cx="7.5" cy="2.5" r="1.2" /><circle cx="7.5" cy="7.5" r="1.2" /><circle cx="7.5" cy="12.5" r="1.2" />
  </svg>
);

const ib = [
  'flex h-11 w-11 items-center justify-center rounded-md transition-colors sm:h-7 sm:w-7',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1',
].join(' ');

export function EmployeeActionMenu({
  isActive, isToggling, totpEnabled, isSelf,
  onEdit, onDelete, onResetPwd, onToggleStatus, on2FA, onReport,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (fn: () => void) => { fn(); setOpen(false); };

  return (
    <div ref={ref} className="flex items-center gap-0.5">

      {/* Desktop quick-action icon buttons */}
      <div className="hidden items-center gap-0.5 md:flex">
        <button
          onClick={onEdit}
          title="Edit employee"
          aria-label="Edit employee"
          className={`${ib} text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200`}
        >
          <IcEdit />
        </button>
        {!isSelf && (
          <button
            onClick={onToggleStatus}
            disabled={isToggling}
            title={isActive ? 'Deactivate employee' : 'Activate employee'}
            aria-label={isActive ? 'Deactivate employee' : 'Activate employee'}
            className={`${ib} disabled:cursor-not-allowed disabled:opacity-40 ${
              isActive
                ? 'text-slate-400 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-900/20 dark:hover:text-amber-400'
                : 'text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-900/20 dark:hover:text-emerald-400'
            }`}
          >
            {isActive ? <IcPause /> : <IcCheck />}
          </button>
        )}
      </div>

      {/* ⋯ overflow button — visible on all breakpoints */}
      <div className="relative">
        <button
          onClick={() => setOpen(v => !v)}
          title="More actions"
          aria-label="More actions"
          aria-expanded={open}
          aria-haspopup="menu"
          className={`${ib} ${open
            ? 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
            : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200'
          }`}
        >
          <IcDots />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 top-9 z-50 min-w-[14rem] rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl ring-1 ring-black/5 dark:border-slate-700 dark:bg-slate-900 dark:ring-white/[0.08]"
          >
            {/* Mobile only: Edit + Status (desktop shows them inline) */}
            <div className="md:hidden">
              <button role="menuitem" onClick={() => run(onEdit)}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800">
                <span className="w-4 shrink-0 text-slate-400"><IcEdit /></span>Edit
              </button>
              {!isSelf && (
                <button role="menuitem" onClick={() => run(onToggleStatus)} disabled={isToggling}
                  className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-sm disabled:opacity-40 hover:bg-slate-50 focus-visible:outline-none focus-visible:bg-slate-50 dark:hover:bg-slate-800 ${isActive ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  <span className="w-4 shrink-0">{isActive ? <IcPause /> : <IcCheck />}</span>
                  {isActive ? 'Deactivate' : 'Activate'}
                </button>
              )}
              <div className="mx-3 my-1 border-t border-slate-100 dark:border-slate-800" />
            </div>

            {/* Security actions */}
            <button role="menuitem" onClick={() => run(onResetPwd)}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800">
              <span className="w-4 shrink-0 text-slate-400"><IcKey /></span>Reset Password
            </button>
            <button role="menuitem" onClick={() => run(on2FA)}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800">
              <span className={`w-4 shrink-0 ${totpEnabled ? 'text-emerald-500' : 'text-slate-400'}`}><IcShield /></span>
              {totpEnabled ? 'Reset 2FA' : 'Enable 2FA'}
              {totpEnabled && (
                <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                  On
                </span>
              )}
            </button>
            <button role="menuitem" onClick={() => run(onReport)}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-indigo-600 hover:bg-indigo-50 focus-visible:outline-none focus-visible:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/20">
              <span className="w-4 shrink-0 text-indigo-400"><IcChart /></span>Performance Report
            </button>

            {/* Danger zone */}
            {!isSelf && (
              <>
                <div className="mx-3 my-1 border-t border-slate-100 dark:border-slate-800" />
                <button role="menuitem" onClick={() => run(onDelete)}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/20">
                  <span className="w-4 shrink-0 text-red-400"><IcTrash /></span>Delete Employee
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
