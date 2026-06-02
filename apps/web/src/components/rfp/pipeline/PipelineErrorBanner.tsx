import { useTranslation } from 'react-i18next';

import { useRfpPipelineStore } from '@/stores/rfpPipeline';
import { Button } from '@/components/ui/Button';

interface PipelineErrorBannerProps {
  error: string | null;
}

export function PipelineErrorBanner({ error }: PipelineErrorBannerProps) {
  const { t } = useTranslation('rfp');
  const retry = useRfpPipelineStore((s) => s.retry);
  const reset = useRfpPipelineStore((s) => s.reset);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-xl border border-[var(--danger)] bg-[var(--danger-tint)] p-4"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 text-lg leading-none text-[var(--danger)]">
          ✕
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-[var(--danger)]">{t('pipeline.errorTitle')}</p>
          {error && <p className="mt-1 text-xs text-[var(--danger)]/80">{error}</p>}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="destructive" onClick={retry}>
          {t('pipeline.errorRetry')}
        </Button>
        <Button variant="secondary" onClick={reset}>
          {t('pipeline.errorReset')}
        </Button>
      </div>
    </div>
  );
}
