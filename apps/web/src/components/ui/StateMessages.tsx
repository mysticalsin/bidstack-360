import type { ReactNode } from 'react';

interface BaseProps {
  title: string;
  message?: string;
  action?: ReactNode;
}

export function EmptyState({ title, message, action }: BaseProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-3xl mb-3" aria-hidden>
        ✨
      </div>
      <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{title}</h3>
      {message ? (
        <p className="mt-1 max-w-sm text-xs text-[var(--fg-secondary)]">{message}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title, message, action }: BaseProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center py-16 text-center"
    >
      <div className="text-3xl mb-3" aria-hidden>
        ⚠
      </div>
      <h3 className="text-sm font-semibold text-[var(--danger)]">{title}</h3>
      {message ? (
        <p className="mt-1 max-w-sm text-xs text-[var(--fg-secondary)]">{message}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-12 rounded-md bg-[var(--surface-sunken)] animate-pulse"
        />
      ))}
    </div>
  );
}
