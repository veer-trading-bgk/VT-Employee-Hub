'use client';

import { useQuery } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { currentMonthLabel } from '@/utils/date-utils';
import { exportTableToCsv, printToPdf } from '@/utils/export';

interface CompensationResponse {
  month: number;
  year: number;
  breakdown: Record<string, { count: number; rate: number; amount: number }>;
  baseCompensation: number;
  performanceBonus: number;
  totalCompensation: number;
}

const INCENTIVE_LABELS: Record<string, string> = {
  kyc: 'KYC Accounts',
  demat: 'Demat Accounts',
  mf: 'MF Orders',
  insurance: 'Insurance',
  algo: 'Algo Activation',
  coaching: 'Coaching Revenue',
};

export default function CompensationPage() {
  const { user } = useAuthStore();

  const { data, isLoading } = useQuery({
    queryKey: ['my-compensation', user?.id],
    queryFn: () => apiFetch<CompensationResponse>(`/api/compensation/calculate/${user?.id ?? 'me'}`),
    enabled: !!user,
    staleTime: 1000 * 60 * 10,
  });

  const breakdown = data?.breakdown ?? {};

  const exportRows = Object.entries(breakdown).map(([key, val]) => ({
    metric: INCENTIVE_LABELS[key] ?? key,
    count: val.count,
    rate_per_unit: `₹${val.rate}`,
    amount: val.amount,
  }));

  return (
    <>
      <Navbar title="My Compensation" />
      <div className="space-y-6 p-4 md:p-8 max-w-3xl print:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              💰 Compensation Statement
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              {currentMonthLabel()} · {user?.email}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => exportTableToCsv(exportRows, `compensation_${user?.id}`)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
            >
              📥 Export CSV
            </button>
            <button
              onClick={() => printToPdf(`VT Compensation ${currentMonthLabel()}`)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
            >
              🖨️ Print
            </button>
          </div>
        </div>

        {isLoading ? (
          <Loading />
        ) : !data ? (
          <p className="text-slate-500">No compensation data found.</p>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Base Incentive</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">
                  ₹{data.baseCompensation.toLocaleString('en-IN')}
                </p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mb-1">Performance Bonus</p>
                <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                  ₹{data.performanceBonus.toLocaleString('en-IN')}
                </p>
                {data.performanceBonus > 0 && (
                  <p className="text-[10px] text-emerald-600 mt-0.5">🎉 Target hit! +10% bonus</p>
                )}
              </div>
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5 dark:border-indigo-900/40 dark:bg-indigo-950/20">
                <p className="text-xs text-indigo-600 dark:text-indigo-400 mb-1">Total Payout</p>
                <p className="text-2xl font-bold text-indigo-700 dark:text-indigo-400">
                  ₹{data.totalCompensation.toLocaleString('en-IN')}
                </p>
              </div>
            </div>

            {/* Breakdown table */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="mb-4 font-semibold text-slate-900 dark:text-white">Incentive Breakdown</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-xs font-semibold uppercase text-slate-500">
                      <th className="pb-3 pr-6">Metric</th>
                      <th className="pb-3 pr-6">Count</th>
                      <th className="pb-3 pr-6">Rate</th>
                      <th className="pb-3">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {Object.entries(breakdown).map(([key, val]) => (
                      <tr key={key} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="py-2.5 pr-6 font-medium text-slate-900 dark:text-white">
                          {INCENTIVE_LABELS[key] ?? key}
                        </td>
                        <td className="py-2.5 pr-6 tabular-nums text-slate-700 dark:text-slate-300">
                          {val.count}
                        </td>
                        <td className="py-2.5 pr-6 text-slate-500">₹{val.rate}</td>
                        <td className="py-2.5 font-semibold text-slate-900 dark:text-white">
                          ₹{val.amount.toLocaleString('en-IN')}
                        </td>
                      </tr>
                    ))}
                    {/* Totals */}
                    <tr className="border-t-2 border-slate-200 dark:border-slate-700 font-bold">
                      <td className="pt-3 pr-6 text-slate-900 dark:text-white" colSpan={3}>
                        Base Incentive
                      </td>
                      <td className="pt-3 text-slate-900 dark:text-white">
                        ₹{data.baseCompensation.toLocaleString('en-IN')}
                      </td>
                    </tr>
                    {data.performanceBonus > 0 && (
                      <tr className="font-bold text-emerald-600">
                        <td className="py-1 pr-6" colSpan={3}>Performance Bonus (10%)</td>
                        <td className="py-1">₹{data.performanceBonus.toLocaleString('en-IN')}</td>
                      </tr>
                    )}
                    <tr className="border-t-2 border-indigo-200 font-bold text-indigo-700 dark:border-indigo-900 dark:text-indigo-400">
                      <td className="pt-3 pr-6" colSpan={3}>Total Payout</td>
                      <td className="pt-3">₹{data.totalCompensation.toLocaleString('en-IN')}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Formula reference */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/50">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Incentive Rates</p>
              <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                <span>KYC: ₹200/account</span>
                <span>·</span>
                <span>Demat: ₹300/account</span>
                <span>·</span>
                <span>MF: ₹250/order</span>
                <span>·</span>
                <span>Insurance: ₹500/policy</span>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
