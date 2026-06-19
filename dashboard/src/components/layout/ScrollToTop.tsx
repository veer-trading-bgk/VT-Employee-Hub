'use client';

import { useEffect, useState } from 'react';

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 300);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      aria-label="Scroll to top"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className={[
        'fixed bottom-24 right-4 z-30 md:bottom-6',
        'flex h-10 w-10 items-center justify-center rounded-full',
        'border border-slate-200 bg-white shadow-lg',
        'transition-all hover:bg-slate-50 active:scale-95',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
        'dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700',
      ].join(' ')}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-slate-600 dark:text-slate-400"
        aria-hidden="true"
      >
        <polyline points="18 15 12 9 6 15" />
      </svg>
    </button>
  );
}
