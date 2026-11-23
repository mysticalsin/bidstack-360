import { Component, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface BoundaryProps {
  children: ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

/**
 * Catches a render failure inside one section. The shell (and every sibling
 * section) stays mounted. Retry resets this boundary only — it never reloads
 * the window, because a single broken panel is not an app crash.
 */
export class SectionErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  private reset = () => {
    this.setState({ error: null });
  };

  override render() {
    if (this.state.error) {
      return <SectionFallback onRetry={this.reset} />;
    }
    return this.props.children;
  }
}

function SectionFallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation('crm');
  return (
    <div
      role="alert"
      data-testid="section-error-fallback"
      className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-5 py-8 text-center"
    >
      <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
        {t('sectionFallback.title', "This section couldn't load")}
      </h2>
      <p className="mx-auto mt-1 max-w-sm text-xs text-[var(--fg-secondary)]">
        {t(
          'sectionFallback.description',
          'The rest of the app is still available. You can try this section again.',
        )}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-4 text-sm font-medium text-[var(--fg-secondary)] hover:bg-[var(--surface-sunken)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
      >
        {t('sectionFallback.retry', 'Try again')}
      </button>
    </div>
  );
}
