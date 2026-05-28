/**
 * ReceiveStep — upload dropzone + document list for the Intake workflow.
 * Step 1: user selects (and optionally uploads) documents for extraction.
 */
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { Icon } from '@/components/ui/Icon';
import { toast } from '@/components/ui/Toast';
import { type useFiles, useUploadFile } from '@/hooks/useFiles';

interface ReceiveStepProps {
  accountId: string;
  files: ReturnType<typeof useFiles>;
  selectedDocs: Set<string>;
  onToggle: (id: string) => void;
  onNext: () => void;
}

export function ReceiveStep({
  accountId,
  files,
  selectedDocs,
  onToggle,
  onNext,
}: ReceiveStepProps) {
  const upload = useUploadFile(accountId);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    for (const file of Array.from(e.dataTransfer.files)) {
      upload.mutate(file, {
        onSuccess: () => toast.success(`Uploaded ${file.name}`),
        onError: (err) =>
          toast.error('Upload failed', { description: err instanceof Error ? err.message : '' }),
      });
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    for (const file of Array.from(e.target.files ?? [])) {
      upload.mutate(file, {
        onSuccess: () => toast.success(`Uploaded ${file.name}`),
        onError: (err) =>
          toast.error('Upload failed', { description: err instanceof Error ? err.message : '' }),
      });
    }
    e.target.value = '';
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Select documents</h2>
        <span className="text-xs text-[var(--fg-tertiary)]">{selectedDocs.size} selected</span>
      </div>

      {/* Upload dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
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
          Drag & drop files here or{' '}
          <label className="cursor-pointer text-[var(--brand-primary)] hover:underline">
            browse
            <input type="file" multiple className="sr-only" onChange={handleFileInput} />
          </label>
        </p>
        <p className="text-[10px] text-[var(--fg-secondary)]">
          PDF, DOCX, PPTX, XLSX, TXT, images and scans — up to 50 MB
        </p>
        <p className="text-[10px] text-[var(--fg-secondary)]">
          Scanned PDFs and images are OCR-ready when the server OCR runtime is enabled.
        </p>
        {upload.isPending && (
          <div className="mt-2 flex items-center justify-center gap-2 text-xs text-[var(--fg-secondary)]">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" />
            Uploading…
          </div>
        )}
      </div>

      {!accountId ? (
        <EmptyState title="No account selected" message="Add ?account=ACCOUNT_ID to the URL." />
      ) : files.isError ? (
        <ErrorState title="Failed to load files" message={files.error?.message} />
      ) : files.isLoading ? (
        <div className="h-32 flex items-center justify-center text-xs text-[var(--fg-tertiary)]">
          Loading…
        </div>
      ) : files.data?.items.length === 0 ? (
        <EmptyState
          title="No documents yet"
          message="Upload documents above or use the account file manager."
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
                  {f.contentType} · {(f.bytes / 1024).toFixed(0)} KB
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
          aria-label="Continue to extract step"
        >
          Next: Extract →
        </Button>
      </div>
    </Card>
  );
}
