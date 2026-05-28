import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useRfpUpload } from '@/hooks/rfp/useRfpUpload';

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const ACCEPTED_EXTS = '.pdf,.docx';
const MAX_MB = 50;

export function RfpUploadZone() {
  const { t } = useTranslation('rfp');
  const { id: opportunityId } = useParams<{ id: string }>();
  const { upload, error } = useRfpUpload();

  const [isDragging, setIsDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validate = (file: File): string | null => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return t('upload.errorType');
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      return t('upload.errorSize', { max: MAX_MB });
    }
    return null;
  };

  const handleFile = useCallback(
    (file: File) => {
      const err = validate(file);
      if (err) {
        setLocalError(err);
        return;
      }
      setLocalError(null);
      if (!opportunityId) {
        setLocalError('Missing opportunity ID');
        return;
      }
      upload(file, opportunityId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opportunityId, upload],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = () => setIsDragging(false);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // reset so the same file can be re-selected after fixing an error
    e.target.value = '';
  };

  const displayError = localError ?? error;

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <div
        role="region"
        aria-label={t('upload.dropzoneLabel')}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={[
          'flex w-full max-w-lg cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center transition-colors',
          isDragging
            ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)]/5'
            : 'border-[var(--border-subtle)] bg-[var(--surface-card)] hover:border-[var(--brand-primary)]',
        ].join(' ')}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        tabIndex={0}
      >
        <span
          className="grid h-12 w-12 place-items-center rounded-xl"
          style={{ background: 'linear-gradient(135deg, #B49CFF 0%, #7C3AED 100%)' }}
          aria-hidden="true"
        >
          <Icon name="files" size={24} ariaHidden />
        </span>
        <div>
          <p className="text-sm font-semibold text-[var(--fg-primary)]">{t('upload.title')}</p>
          <p className="mt-1 text-xs text-[var(--fg-secondary)]">{t('upload.dropzone')}</p>
          <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">PDF or DOCX, max {MAX_MB} MB</p>
        </div>
        <Button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
          aria-label={t('upload.browse')}
        >
          {t('upload.browse')}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTS}
          className="sr-only"
          aria-hidden="true"
          onChange={onInputChange}
        />
      </div>
      {displayError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {displayError}
        </p>
      )}
    </div>
  );
}
