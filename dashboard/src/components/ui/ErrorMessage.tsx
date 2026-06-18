export function ErrorMessage({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-900 dark:bg-rose-950">
      <p className="text-sm font-medium text-rose-700 dark:text-rose-300">⚠️ {message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rose-700"
        >
          Retry
        </button>
      )}
    </div>
  );
}
