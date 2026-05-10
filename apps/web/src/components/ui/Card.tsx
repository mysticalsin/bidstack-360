import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

export function Card({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] shadow-[var(--shadow-xs)]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

interface SectionHeaderProps {
  title: string;
  caption?: string;
  action?: ReactNode;
}

export function SectionHeader({ title, caption, action }: SectionHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border-subtle)]">
      <div>
        <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{title}</h3>
        {caption ? (
          <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">{caption}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
