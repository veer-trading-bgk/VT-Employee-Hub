'use client';

const AVATAR_COLORS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#ec4899',
];

function hashColor(str: string): string {
  if (!str) return '#94a3b8';
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}

function initials(name: string, fallback: string): string {
  if (name) {
    return name.split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  }
  return fallback.slice(-2).toUpperCase();
}

const SIZE_CLS: Record<string, string> = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-12 w-12 text-sm',
  lg: 'h-16 w-16 text-base',
};

interface ContactAvatarProps {
  name: string;
  contactId: string;
  size?: 'sm' | 'md' | 'lg';
}

export function ContactAvatar({ name, contactId, size = 'md' }: ContactAvatarProps) {
  const color = hashColor(contactId || name);
  const letters = initials(name, contactId || '??');

  return (
    <div
      role="img"
      aria-label={name || contactId}
      className={`flex flex-shrink-0 items-center justify-center rounded-full font-bold text-white ${SIZE_CLS[size] ?? SIZE_CLS.md}`}
      style={{ backgroundColor: color }}
    >
      {letters}
    </div>
  );
}
