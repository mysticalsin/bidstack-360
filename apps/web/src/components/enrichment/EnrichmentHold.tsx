import type { ReactNode } from 'react';

import type { EnrichmentGate } from './enrichment-read';

export function EnrichmentHold({
  testId,
  titleId,
  title,
  titleClassName,
  gate,
  loading,
  error,
  onRetry,
}: {
  testId: string;
  titleId: string;
  title: string;
  titleClassName?: string;
  gate: Extract<EnrichmentGate, 'loading' | 'error'>;
  loading: string;
  error: string;
  onRetry: () => void;
}): ReactNode {
  return (
    <section
      className="en-section"
      aria-labelledby={titleId}
      aria-busy={gate === 'loading' ? true : undefined}
      data-testid={testId}
    >
      <header className="en-head">
        <h2 id={titleId} className={titleClassName}>
          {title}
        </h2>
      </header>
      {gate === 'loading' ? (
        <p className="en-meta">{loading}</p>
      ) : (
        <p className="en-meta" role="alert">
          <span>{error}</span> <span>Please try again.</span>{' '}
          <button type="button" className="en-link en-retry" onClick={onRetry}>
            Retry
          </button>
        </p>
      )}
    </section>
  );
}
