import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export type CockpitSourceState = 'apollo_fresh' | 'apollo_stale' | 'verified' | 'crm' | 'missing';

interface SourceBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  label: string;
  state: CockpitSourceState;
  hint: string;
}

const STATE_CLASS: Record<CockpitSourceState, string> = {
  apollo_fresh: 'bg-[var(--success-tint)] text-[var(--success)]',
  apollo_stale: 'bg-[var(--warning-tint)] text-[var(--warning)]',
  verified: 'bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]',
  crm: 'bg-[var(--surface-sunken)] text-[var(--fg-tertiary)]',
  missing: 'bg-[var(--warning-tint)] text-[var(--warning)]',
};

export function SourceBadge({ label, state, hint, className, ...rest }: SourceBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
        STATE_CLASS[state],
        className,
      )}
      aria-label={hint}
      title={hint}
      {...rest}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}
