import { ErrorBoundary as SentryErrorBoundary } from '@sentry/react';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

function FallbackComponent() {
  const handleReload = () => {
    window.location.reload();
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-surface-page px-6"
      data-testid="error-boundary-fallback"
    >
      <div className="w-full max-w-md rounded-xl border border-border-default bg-surface-card p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-danger-tint">
            <svg
              className="h-5 w-5 text-danger"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-fg-primary">Something went wrong</h1>
        </div>

        <p className="mb-6 text-sm text-fg-secondary">
          We&apos;re sorry, but an unexpected error has occurred. Please try reloading the page.
        </p>

        <button
          type="button"
          onClick={handleReload}
          className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-fg-on-brand transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        >
          Reload page
        </button>
      </div>
    </div>
  );
}

export function ErrorBoundary({ children }: Props) {
  return <SentryErrorBoundary fallback={<FallbackComponent />}>{children}</SentryErrorBoundary>;
}
