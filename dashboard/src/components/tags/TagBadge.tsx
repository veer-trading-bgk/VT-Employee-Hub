'use client';

export interface Tag {
  id: string;
  label: string;
  color: string;
  createdAt?: string;
  aiAssignable?: boolean;
}

interface TagBadgeProps {
  tag: Tag;
  onRemove?: (e: React.MouseEvent) => void;
  size?: 'xs' | 'sm';
}

export function TagBadge({ tag, onRemove, size = 'xs' }: TagBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-semibold ${
        size === 'xs' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
      }`}
      style={{
        backgroundColor: tag.color + '20',
        color: tag.color,
        borderColor: tag.color + '50',
      }}
    >
      {tag.label}
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-0.5 flex h-3 w-3 items-center justify-center rounded-full opacity-60 transition hover:opacity-100"
          title={`Remove ${tag.label}`}
          type="button"
        >
          ×
        </button>
      )}
    </span>
  );
}
