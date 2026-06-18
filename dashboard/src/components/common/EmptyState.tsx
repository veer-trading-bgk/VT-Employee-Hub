interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon = '📭', title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <span className="mb-4 text-5xl">{icon}</span>
      <h3 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h3>
      {description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
