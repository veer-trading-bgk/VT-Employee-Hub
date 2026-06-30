import { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type AvatarSize = 20 | 24 | 32 | 40 | 48 | 64;
export type AvatarVariant = 'initials' | 'image' | 'placeholder';

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  name?: string;
  src?: string;
  size?: AvatarSize;
  variant?: AvatarVariant;
}

const sizeStyles: Record<AvatarSize, string> = {
  20: 'h-5 w-5 text-[9px]',
  24: 'h-6 w-6 text-[10px]',
  32: 'h-8 w-8 text-xs',
  40: 'h-10 w-10 text-sm',
  48: 'h-12 w-12 text-base',
  64: 'h-16 w-16 text-lg',
};

// Deterministic color from name — 8 accessible background/foreground pairs
const COLOR_PAIRS = [
  ['#DBEAFE', '#1D4ED8'],
  ['#DCFCE7', '#15803D'],
  ['#FEF3C7', '#B45309'],
  ['#FCE7F3', '#9D174D'],
  ['#E0E7FF', '#4338CA'],
  ['#CCFBF1', '#0F766E'],
  ['#FEE2E2', '#B91C1C'],
  ['#F5F3FF', '#6D28D9'],
];

function getColorPair(name: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return COLOR_PAIRS[Math.abs(hash) % COLOR_PAIRS.length] as [string, string];
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  src,
  size = 40,
  className,
  ...props
}: AvatarProps) {
  const [bg, fg] = name ? getColorPair(name) : ['#E2E8F0', '#64748B'];
  const initials = name ? getInitials(name) : '?';

  if (src) {
    return (
      <div
        className={cn(
          'relative shrink-0 overflow-hidden rounded-full',
          sizeStyles[size],
          className,
        )}
        {...props}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={name ?? 'Avatar'}
          className="h-full w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold',
        sizeStyles[size],
        className,
      )}
      style={{ backgroundColor: bg, color: fg }}
      aria-label={name ?? 'User avatar'}
      {...props}
    >
      {initials}
    </div>
  );
}
