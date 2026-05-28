import { useTranslation } from 'react-i18next';

import { useRfpPipelineStore } from '@/stores/rfpPipeline';

interface PipelineErrorBannerProps {
  error: string | null;
}

export function PipelineErrorBanner({ error }: PipelineErrorBannerProps) {
  const { t } = useTranslation('rfp');
  const reset = useRfpPipelineStore((s) => s.reset);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/30"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 text-lg leading-none text-red-600 dark:text-red-400"
        >
          ✕
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-red-800 dark:text-red-200">
            {t('pipeline.errorTitle')}
          </p>
          {error && <p className="mt-1 text-xs text-red-700 dark:text-red-300">{error}</p>}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="min-h-[44px] rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 dark:bg-red-700 dark:hover:bg-red-600"
        >
          {t('pipeline.errorRetry')}
        </button>
      </div>
    </div>
  );
}
