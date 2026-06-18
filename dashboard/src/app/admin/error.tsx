'use client';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="text-5xl">⚠️</div>
      <h2 className="text-xl font-bold text-slate-900 dark:text-white">Something went wrong</h2>
      <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
        {error.message || 'An unexpected error occurred. Please try again.'}
      </p>
      <button
        onClick={reset}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
      >
        Try again
      </button>
    </div>
  );
}
