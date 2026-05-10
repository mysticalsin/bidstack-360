import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export type BadgeTone = 'blue' | 'jade' | 'amber' | 'tomato' | 'purple' | 'gray';

const TONE_MAP: Record<BadgeTone, string> = {
  blue: 'bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]',
  jade: 'bg-[var(--tag-jade-bg)] text-[var(--tag-jade-fg)]',
  amber: 'bg-[var(--tag-amber-bg)] text-[var(--tag-amber-fg)]',
  tomato: 'bg-[var(--tag-tomato-bg)] text-[var(--tag-tomato-fg)]',
  purple: 'bg-[var(--tag-purple-bg)] text-[var(--tag-purple-fg)]',
  gray: 'bg-[var(--tag-gray-bg)] text-[var(--tag-gray-fg)]',
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = 'gray', className, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        TONE_MAP[tone],
        className,
      )}
      {...rest}
    />
  );
}

const STAGE_TONE: Record<string, BadgeTone> = {
  discovery: 'gray',
  qualified: 'purple',
  proposal: 'blue',
  negotiation: 'amber',
  closed_won: 'jade',
  closed_lost: 'tomato',
};

export function stageTone(stage: string): BadgeTone {
  return STAGE_TONE[stage] ?? 'gray';
}
