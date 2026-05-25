import type { ReactNode } from 'react';

import { Icon, type IconName } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

interface UpgradeBannerProps {
  title: string;
  message?: ReactNode;
  actionLabel?: string;
  href?: string;
  onAction?: () => void;
  icon?: IconName;
  className?: string;
}

export function UpgradeBanner({
  title,
  message,
  actionLabel = 'Upgrade',
  href,
  onAction,
  icon = 'sparkle',
  className,
}: UpgradeBannerProps) {
  const actionClassName =
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white shadow-[var(--shadow-xs)] transition-colors hover:bg-[var(--brand-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)] active:bg-[var(--brand-primary-press)]';
  const action =
    href !== undefined ? (
      <a href={href} className={actionClassName}>
        {actionLabel}
        <Icon name="arrow" size={16} ariaHidden />
      </a>
    ) : onAction ? (
      <button type="button" onClick={onAction} className={actionClassName}>
        {actionLabel}
        <Icon name="arrow" size={16} ariaHidden />
      </button>
    ) : null;

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-xs)]',
        className,
      )}
    >
      <div
        aria-hidden
        className="absolute inset-y-0 right-0 w-1/3 bg-[linear-gradient(120deg,transparent,var(--brand-primary-tint))]"
      />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]">
            <Icon name={icon} size={20} ariaHidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--fg-primary)]">{title}</h2>
            {message ? <p className="mt-1 text-sm text-[var(--fg-secondary)]">{message}</p> : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </section>
  );
}
