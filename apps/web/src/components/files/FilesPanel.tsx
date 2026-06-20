// FilesPanel — drag-drop upload zone + attachment list for a customer account.
// Used inside the cockpit aside on the dashboard.

import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, SectionHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { downloadFileUrl, useDeleteFile, useFiles, useUploadFile } from '@/hooks/useFiles';
import { relativeTime } from '@/lib/format';
import {
  classifyDocument,
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  FILE_INPUT_ACCEPT,
  inferAllowedFileContentType,
  type DocumentCategory,
  type FileAttachment,
} from '@bidstack/shared';

interface FilesPanelProps {
  accountId: string;
}

export function FilesPanel({ accountId }: FilesPanelProps) {
  const { t } = useTranslation('crm');
  const list = useFiles(accountId);
  const upload = useUploadFile(accountId);
  const remove = useDeleteFile(accountId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<FileAttachment | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Organize the flat file list into library categories (MSA, rate card,
  // win/loss, …) computed from the filename — no schema column needed.
  const grouped = useMemo(() => {
    const items = list.data?.items ?? [];
    const byCategory = new Map<DocumentCategory, FileAttachment[]>();
    for (const file of items) {
      const category = classifyDocument(file.name, file.contentType);
      const bucket = byCategory.get(category) ?? [];
      bucket.push(file);
      byCategory.set(category, bucket);
    }
    return DOCUMENT_CATEGORIES.filter((c) => byCategory.has(c)).map((category) => ({
      category,
      files: byCategory.get(category) ?? [],
    }));
  }, [list.data]);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError(null);
    Array.from(files).forEach((file) => {
      // Why client-side type check: gives instant feedback before round-tripping
      // a multi-MB file. Server still re-validates via Zod (defense in depth).
      if (!inferAllowedFileContentType(file.name, file.type)) {
        setUploadError(
          t('files.unsupportedType', 'Unsupported file type: {{type}}', {
            type: file.type || file.name || t('files.unknownType', 'unknown'),
          }),
        );
        return;
      }
      upload.mutate(file, {
        onError: (err) => setUploadError(err.message),
      });
    });
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    handleFiles(event.dataTransfer.files);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(true);
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    handleFiles(event.target.files);
    // Reset so re-uploading the same file fires `change` again.
    event.target.value = '';
  }

  return (
    <Card aria-label={t('files.cardLabel', 'Files')}>
      <SectionHeader
        title={t('files.heading', 'Files')}
        caption={
          list.data
            ? t('files.attachmentCountScoped', '{{count}} attachment(s) - access follows account groups', {
                count: list.data.items.length,
              })
            : t('files.accessScoped', 'Access follows account groups')
        }
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={upload.isPending}
          >
            {upload.isPending ? t('files.uploading', 'Uploading…') : t('files.upload', 'Upload')}
          </Button>
        }
      />

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={FILE_INPUT_ACCEPT}
        onChange={onChange}
        className="sr-only"
        aria-label={t('files.inputLabel', 'Choose files to upload')}
      />

      <div
        role="button"
        tabIndex={0}
        aria-label={t('files.dropzoneLabel', 'Drag files here to upload')}
        className={`m-4 rounded-lg border-2 border-dashed p-6 text-center transition-colors cursor-pointer min-h-11 ${
          dragActive
            ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)]'
            : 'border-[var(--border-default)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-sunken)]'
        } focus:outline-none focus:ring-2 focus:ring-border-focus`}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={() => setDragActive(false)}
      >
        <FileGlyph aria-hidden />
        <p className="mt-2 text-xs font-medium text-[var(--fg-primary)]">
          {t('files.dropPrompt', 'Drop files or click to browse')}
        </p>
        <p className="mt-0.5 text-[11px] text-[var(--fg-tertiary)]">
          {t('files.acceptedFormats', 'PDF, DOCX, XLSX, images — up to 50 MB')}
        </p>
      </div>

      {uploadError ? (
        <p
          role="alert"
          className="mx-4 -mt-2 mb-3 rounded-md border border-[var(--danger)] bg-[var(--danger-tint)] px-3 py-2 text-xs text-[var(--danger)]"
        >
          {uploadError}
        </p>
      ) : null}

      {list.isLoading ? (
        <LoadingSkeleton rows={3} />
      ) : list.isError ? (
        <ErrorState
          title={t('files.loadErrorTitle', "Couldn't load files")}
          message={list.error?.message ?? t('files.unknownError', 'Unknown error')}
        />
      ) : list.data && list.data.items.length === 0 ? (
        <EmptyState
          title={t('files.emptyTitle', 'No files yet')}
          message={t('files.emptyMessage', 'Upload to attach documents to this account.')}
        />
      ) : (
        <div className="divide-y divide-[var(--border-subtle)]">
          {grouped.map(({ category, files }) => (
            <section key={category}>
              <div className="flex items-center justify-between px-5 pb-1 pt-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
                  {t(`documentCategory.${category}`, DOCUMENT_CATEGORY_LABELS[category])}
                </h3>
                <span className="text-[11px] text-[var(--fg-tertiary)]">{files.length}</span>
              </div>
              <ul>
                {files.map((file) => (
                  <FileRow key={file.id} file={file} onDelete={() => setPendingDelete(file)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        {pendingDelete ? (
          <DialogContent
            title={t('files.deleteTitle', 'Delete file?')}
            description={t(
              'files.deleteDescription',
              'This permanently removes "{{name}}". This cannot be undone.',
              { name: pendingDelete.name },
            )}
          >
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" size="sm" onClick={() => setPendingDelete(null)}>
                {t('files.cancel', 'Cancel')}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  const id = pendingDelete.id;
                  remove.mutate(id, { onSuccess: () => setPendingDelete(null) });
                }}
                disabled={remove.isPending}
              >
                {remove.isPending ? t('files.deleting', 'Deleting…') : t('files.delete', 'Delete')}
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </Card>
  );
}

function FileRow({ file, onDelete }: { file: FileAttachment; onDelete: () => void }) {
  const { t } = useTranslation('crm');
  return (
    <li className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--surface-sunken)] transition-colors">
      <FileGlyph contentType={file.contentType} />
      <a
        href={downloadFileUrl(file.id)}
        className="min-w-0 flex-1 group"
        title={t('files.downloadTitle', 'Download {{name}}', { name: file.name })}
      >
        <div className="truncate text-sm font-medium text-[var(--fg-primary)] group-hover:underline">
          {file.name}
        </div>
        <div className="text-[11px] text-[var(--fg-tertiary)]">
          {humanizeBytes(file.bytes)} · {file.uploadedByEmail ?? t('files.unknownUploader', 'unknown')} ·{' '}
          {relativeTime(file.createdAt)}
        </div>
      </a>
      <button
        type="button"
        aria-label={t('files.deleteAria', 'Delete {{name}}', { name: file.name })}
        onClick={onDelete}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--danger-tint)] hover:text-[var(--danger)] focus:outline-none focus:ring-2 focus:ring-border-focus pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      >
        <TrashGlyph />
      </button>
    </li>
  );
}

// ─── Inline icons (no new icon set per task scope) ───────────────────────

function FileGlyph({ contentType }: { contentType?: string }) {
  // Why minimal: the icon set hasn't shipped on this branch. Inline SVGs keep
  // the panel self-contained until the icon component lands.
  const isImage = contentType?.startsWith('image/');
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0 text-[var(--fg-secondary)]"
    >
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path d="M14 3v5h5" />
      {isImage ? <circle cx="10" cy="14" r="1.5" /> : <path d="M9 13h6M9 17h4" />}
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function humanizeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
