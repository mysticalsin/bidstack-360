import { ErrorBoundary as SentryErrorBoundary } from '@sentry/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

const IS_DEV = import.meta.env.DEV;

interface FallbackProps {
  error: unknown;
  componentStack: string;
  eventId: string;
  resetError: () => void;
}

function FallbackComponent({ error, componentStack }: FallbackProps) {
  const { t } = useTranslation('crm');

  const handleReload = () => {
    window.location.reload();
  };

  const handleClear = () => {
    try {
      localStorage.clear();
      window.location.reload();
    } catch {
      /* silent */
    }
  };

  // Log to console so devs can see the actual error even if Sentry isn't configured
  if (IS_DEV) {
    console.error('ErrorBoundary caught:', error, componentStack);
  }

  const errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-surface-page px-6"
      data-testid="error-boundary-fallback"
    >
      <div className="w-full max-w-lg rounded-xl border border-border-default bg-surface-card p-8 shadow-lg">
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
          <h1 className="text-lg font-semibold text-fg-primary">
            {t('errorBoundary.title', 'Something went wrong')}
          </h1>
        </div>

        <p className="mb-4 text-sm text-fg-secondary">
          {t('errorBoundary.description', "We're sorry, but an unexpected error has occurred.")}
        </p>

        {IS_DEV && (
          <div className="mb-4 max-h-48 overflow-auto rounded-lg bg-surface-sunken p-3 font-mono text-xs">
            <div className="mb-1 font-semibold text-danger">{errorMessage}</div>
            {componentStack && (
              <pre className="whitespace-pre-wrap text-fg-secondary">{componentStack}</pre>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleReload}
            className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-fg-on-brand transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            {t('errorBoundary.reloadButton', 'Reload page')}
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center justify-center rounded-lg border border-border-default bg-surface-card px-4 py-2.5 text-sm font-medium text-fg-secondary transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            {t('errorBoundary.clearDataButton', 'Clear app data & reload')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface Props {
  children: ReactNode;
}

export function ErrorBoundary({ children }: Props) {
  return (
    <SentryErrorBoundary fallback={(props) => <FallbackComponent {...props} />}>
      {children}
    </SentryErrorBoundary>
  );
}
