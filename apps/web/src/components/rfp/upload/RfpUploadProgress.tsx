import { useTranslation } from 'react-i18next';

import { useRfpUpload } from '@/hooks/rfp/useRfpUpload';

export function RfpUploadProgress() {
  const { t } = useTranslation('rfp');
  // WHY: we re-use the hook here for read-only progress display.
  // The actual upload was initiated by RfpUploadZone; this component
  // only shows the running progress bar while isUploading is true.
  const { progress, isUploading, cancel } = useRfpUpload();

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('upload.progressLabel')}
      className="flex flex-col items-center gap-3 py-6"
    >
      <p className="text-sm font-medium text-[var(--fg-primary)]">
        {isUploading ? t('upload.uploading') : t('upload.processingUpload')}
      </p>
      <div
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('upload.progressLabel')}
        className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-[var(--border-subtle)]"
      >
        <div
          className="h-full rounded-full bg-[var(--brand-primary)] transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="text-xs text-[var(--fg-tertiary)]">{progress}%</p>
      {isUploading && (
        <button
          type="button"
          onClick={cancel}
          className="min-h-[44px] min-w-[44px] rounded-md px-3 py-2 text-xs text-[var(--fg-secondary)] hover:text-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:hover:text-red-400"
        >
          {t('upload.cancel')}
        </button>
      )}
    </div>
  );
}
