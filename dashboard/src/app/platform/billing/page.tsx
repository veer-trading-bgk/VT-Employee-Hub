'use client';

import { Navbar } from '@/components/layout/Navbar';

export default function PlatformBillingPage() {
  return (
    <>
      <Navbar title="Revenue" showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-4xl p-4 sm:p-6">
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-slate-200 bg-white py-20 dark:border-slate-700 dark:bg-slate-900">
            <span className="text-5xl">💰</span>
            <h2 className="text-lg font-bold text-slate-700 dark:text-slate-200">Revenue Dashboard</h2>
            <p className="max-w-xs text-center text-sm text-slate-400">
              MRR tracking, invoices, and Razorpay subscription data will appear here once billing integration is complete.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
