import Link from 'next/link';
import type { ReactNode } from 'react';

interface LegalPageLayoutProps {
  title: string;
  effectiveDate: string;
  lastUpdated: string;
  children: ReactNode;
}

const LEGAL_LINKS = [
  { href: '/privacy-policy', label: 'Privacy Policy' },
  { href: '/terms', label: 'Terms of Service' },
  { href: '/data-deletion', label: 'Data Deletion Instructions' },
];

// Public, unauthenticated document layout for the 3 Meta App Review legal
// pages (privacy-policy, terms, data-deletion) — all three live outside the
// (v3) route group, same as /login, so none of them sit under
// ProtectedRoute. Deliberately light/document-style rather than the login
// page's dark gradient hero: these are long-form text pages, not a single
// auth moment, so readability wins over the marketing look. Reuses the
// login page's brand mark and primary-600 accent color for consistency.
export function LegalPageLayout({ title, effectiveDate, lastUpdated, children }: LegalPageLayoutProps) {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-5 sm:px-6">
          <Link href="/login" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-600 text-lg font-black text-white">
              A
            </div>
            <span className="text-lg font-black tracking-tight text-slate-900 dark:text-white">APForce</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white sm:text-3xl">{title}</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Effective Date: {effectiveDate} &middot; Last Updated: {lastUpdated}
        </p>

        <div className="legal-content mt-8 text-[15px] leading-7 text-slate-700 dark:text-slate-300">
          {children}
        </div>
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-800">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            {LEGAL_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="text-slate-500 hover:text-primary-600 dark:text-slate-400 dark:hover:text-primary-400">
                {l.label}
              </Link>
            ))}
          </nav>
          <p className="text-slate-400 dark:text-slate-500">&copy; {new Date(effectiveDate).getFullYear()} Viir Trading. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
