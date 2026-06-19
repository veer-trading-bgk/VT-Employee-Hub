interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
  title?: string;
}

export function ErrorMessage({ message, onRetry, title = 'Something went wrong' }: ErrorMessageProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-900/60 dark:bg-rose-950/30"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/40">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-rose-600 dark:text-rose-400"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div>
        <p className="text-sm font-semibold text-rose-800 dark:text-rose-300">{title}</p>
        <p className="mt-0.5 text-sm text-rose-600 dark:text-rose-400">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="min-h-[44px] rounded-lg bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 active:bg-rose-700"
        >
          Try again
        </button>
      )}
    </div>
  );
}
