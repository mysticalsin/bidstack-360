/**
 * ReceiveStep - upload dropzone + document list for the Intake workflow.
 * Step 1: user selects (and optionally uploads) documents for extraction.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { Icon } from '@/components/ui/Icon';
import { toast } from '@/components/ui/Toast';
import { type useFiles, useUploadFile } from '@/hooks/useFiles';
import { FILE_INPUT_ACCEPT } from '@bidstack/shared';

import { IntakeAccountPicker } from './IntakeAccountPicker';

interface ReceiveStepProps {
  accountId: string;
  files: ReturnType<typeof useFiles>;
  selectedDocs: Set<string>;
  onToggle: (id: string) => void;
  onNext: () => void;
  onSelectAccount: (id: string) => void;
}

export function ReceiveStep({
  accountId,
  files,
  selectedDocs,
  onToggle,
  onNext,
  onSelectAccount,
}: ReceiveStepProps) {
  const { t } = useTranslation('crm');
  const upload = useUploadFile(accountId);
  const [isDragging, setIsDragging] = useState(false);
  const canUpload = Boolean(accountId) && !upload.isPending;

  // Selecting an account in IntakeAccountPicker unmounts it (this component
  // switches to the files view), which drops keyboard focus to <body> with
  // no indication of where the user landed. Move focus to this step's
  // heading on the empty→set transition so a keyboard-only user has
  // somewhere meaningful to be, matching the standard route-change focus
  // pattern.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const prevAccountId = useRef(accountId);
  useEffect(() => {
    if (!prevAccountId.current && accountId) {
      headingRef.current?.focus();
    }
    prevAccountId.current = accountId;
  }, [accountId]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (!accountId) {
      toast.info(t('crm.receiveStep.selectAccountFirst', 'Select an account before uploading documents'));
      return;
    }
    for (const file of Array.from(e.dataTransfer.files)) {
      upload.mutate(file, {
        onSuccess: () =>
          toast.success(t('crm.receiveStep.uploadedFile', 'Uploaded {{name}}', { name: file.name })),
        onError: (err) =>
          toast.error(t('crm.receiveStep.uploadFailed', 'Upload failed'), {
            description: err instanceof Error ? err.message : '',
          }),
      });
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!accountId) {
      toast.info(t('crm.receiveStep.selectAccountFirst', 'Select an account before uploading documents'));
      e.target.value = '';
      return;
    }
    for (const file of Array.from(e.target.files ?? [])) {
      upload.mutate(file, {
        onSuccess: () =>
          toast.success(t('crm.receiveStep.uploadedFile', 'Uploaded {{name}}', { name: file.name })),
        onError: (err) =>
          toast.error(t('crm.receiveStep.uploadFailed', 'Upload failed'), {
            description: err instanceof Error ? err.message : '',
          }),
      });
    }
    e.target.value = '';
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-sm font-semibold text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2"
        >
          {t('crm.receiveStep.title', 'Select documents')}
        </h2>
        <span className="text-xs text-[var(--fg-tertiary)]">
          {t('crm.receiveStep.selectedCount', '{{count}} selected', { count: selectedDocs.size })}
        </span>
      </div>

      {/* Upload dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (canUpload) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
          isDragging
            ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)]'
            : 'border-[var(--border-subtle)] bg-[var(--surface-sunken)]'
        }`}
      >
        <Icon name="upload" size={20} className="mx-auto text-[var(--fg-tertiary)]" />
        <p className="mt-1 text-xs text-[var(--fg-secondary)]">
          {t('crm.receiveStep.dragDropPrefix', 'Drag & drop files here or')}{' '}
          <label
            className={`text-[var(--brand-primary)] ${
              canUpload ? 'cursor-pointer hover:underline' : 'cursor-not-allowed opacity-60'
            }`}
          >
            {t('crm.receiveStep.browse', 'browse')}
            <input
              type="file"
              multiple
              accept={FILE_INPUT_ACCEPT}
              disabled={!canUpload}
              className="sr-only"
              onChange={handleFileInput}
            />
          </label>
        </p>
        <p className="text-[10px] text-[var(--fg-secondary)]">
          {t(
            'crm.receiveStep.supportedFormats',
            'PDF, Word, PowerPoint, Excel, text/data, images, audio, and video - up to 50 MB',
          )}
        </p>
        <p className="text-[10px] text-[var(--fg-secondary)]">
          {t(
            'crm.receiveStep.omniparseNote',
            'Omniparse upgrades scans, HEIC images, audio, and video when the worker sidecar is enabled.',
          )}
        </p>
        {upload.isPending && (
          <div className="mt-2 flex items-center justify-center gap-2 text-xs text-[var(--fg-secondary)]">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" />
            {t('crm.receiveStep.uploading', 'Uploading...')}
          </div>
        )}
      </div>

      {!accountId ? (
        <IntakeAccountPicker onSelect={onSelectAccount} />
      ) : files.isError ? (
        <ErrorState
          title={t('crm.receiveStep.loadFailedTitle', 'Failed to load files')}
          message={files.error?.message}
        />
      ) : files.isLoading ? (
        // Shimmer rows shaped like the selectable file rows below — shared
        // bs-shimmer system, not a bare "Loading..." string.
        <div
          className="space-y-2"
          aria-busy="true"
          aria-live="polite"
          aria-label={t('crm.receiveStep.loading', 'Loading...')}
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3"
              aria-hidden
            >
              <span className="bs-shimmer h-5 w-5 rounded" />
              <span className="bs-shimmer h-4 w-1/2" />
              <span className="bs-shimmer ml-auto h-3 w-16" />
            </div>
          ))}
        </div>
      ) : files.data?.items.length === 0 ? (
        <EmptyState
          title={t('crm.receiveStep.noDocsTitle', 'No documents yet')}
          message={t(
            'crm.receiveStep.noDocsMessage',
            'Upload documents above or use the account file manager.',
          )}
        />
      ) : (
        <div className="space-y-2">
          {files.data?.items.map((f) => (
            <label
              key={f.id}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                selectedDocs.has(f.id)
                  ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)]'
                  : 'border-[var(--border-subtle)] bg-[var(--surface-card)] hover:bg-[var(--surface-sunken)]'
              }`}
            >
              <input
                type="checkbox"
                checked={selectedDocs.has(f.id)}
                onChange={() => onToggle(f.id)}
                className="h-4 w-4 accent-[var(--brand-primary)]"
              />
              <Icon name="file" size={16} className="text-[var(--fg-tertiary)]" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-[var(--fg-primary)] truncate">
                  {f.name}
                </div>
                <div className="text-[10px] text-[var(--fg-tertiary)]">
                  {t('crm.receiveStep.fileMeta', '{{type}} - {{size}} KB', {
                    type: f.contentType,
                    size: (f.bytes / 1024).toFixed(0),
                  })}
                </div>
              </div>
            </label>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={onNext}
          disabled={selectedDocs.size === 0}
          aria-label={t('crm.receiveStep.nextAriaLabel', 'Continue to extract step')}
        >
          {t('crm.receiveStep.nextButton', 'Next: Extract ->')}
        </Button>
      </div>
    </Card>
  );
}
