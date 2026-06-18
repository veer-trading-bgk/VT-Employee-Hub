interface LoadingProps {
  label?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function Loading({ label = 'Loading…', size = 'md' }: LoadingProps) {
  const sizes = { sm: 'h-5 w-5', md: 'h-8 w-8', lg: 'h-12 w-12' };
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      <div
        className={`${sizes[size]} animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600 dark:border-slate-700 dark:border-t-indigo-400`}
      />
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}
