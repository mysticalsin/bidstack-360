// FilesPanel — drag-drop upload zone + attachment list for a customer account.
// Used inside the cockpit aside on the dashboard.

import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';

import { Card, SectionHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { downloadFileUrl, useDeleteFile, useFiles, useUploadFile } from '@/hooks/useFiles';
import { relativeTime } from '@/lib/format';
import { ALLOWED_FILE_CONTENT_TYPES, type FileAttachment } from '@bidstack/shared';

interface FilesPanelProps {
  accountId: string;
}

const ACCEPT = ALLOWED_FILE_CONTENT_TYPES.join(',');

export function FilesPanel({ accountId }: FilesPanelProps) {
  const list = useFiles(accountId);
  const upload = useUploadFile(accountId);
  const remove = useDeleteFile(accountId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<FileAttachment | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError(null);
    Array.from(files).forEach((file) => {
      // Why client-side type check: gives instant feedback before round-tripping
      // a multi-MB file. Server still re-validates via Zod (defense in depth).
      if (
        !ALLOWED_FILE_CONTENT_TYPES.includes(
          file.type as (typeof ALLOWED_FILE_CONTENT_TYPES)[number],
        )
      ) {
        setUploadError(`Unsupported file type: ${file.type || 'unknown'}`);
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
    <Card aria-label="Files">
      <SectionHeader
        title="Files"
        caption={list.data ? `${list.data.items.length} attachment(s)` : undefined}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={upload.isPending}
          >
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </Button>
        }
      />

      <div
        role="button"
        tabIndex={0}
        aria-label="Drag files here to upload"
        className={`m-4 rounded-lg border-2 border-dashed p-6 text-center transition-colors cursor-pointer min-h-11 ${
          dragActive
            ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)]'
            : 'border-[var(--border-default)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-sunken)]'
        } focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]`}
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
          Drop files or click to browse
        </p>
        <p className="mt-0.5 text-[11px] text-[var(--fg-tertiary)]">
          PDF, DOCX, XLSX, images — up to 50&nbsp;MB
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          onChange={onChange}
          className="sr-only"
        />
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
        <ErrorState title="Couldn't load files" message={list.error?.message ?? 'Unknown error'} />
      ) : list.data && list.data.items.length === 0 ? (
        <EmptyState title="No files yet" message="Upload to attach documents to this account." />
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {list.data?.items.map((file) => (
            <FileRow key={file.id} file={file} onDelete={() => setPendingDelete(file)} />
          ))}
        </ul>
      )}

      <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        {pendingDelete ? (
          <DialogContent
            title="Delete file?"
            description={`This permanently removes "${pendingDelete.name}". This cannot be undone.`}
          >
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" size="sm" onClick={() => setPendingDelete(null)}>
                Cancel
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
                {remove.isPending ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </Card>
  );
}

function FileRow({ file, onDelete }: { file: FileAttachment; onDelete: () => void }) {
  return (
    <li className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--surface-sunken)] transition-colors">
      <FileGlyph contentType={file.contentType} />
      <a
        href={downloadFileUrl(file.id)}
        className="min-w-0 flex-1 group"
        title={`Download ${file.name}`}
      >
        <div className="truncate text-sm font-medium text-[var(--fg-primary)] group-hover:underline">
          {file.name}
        </div>
        <div className="text-[11px] text-[var(--fg-tertiary)]">
          {humanizeBytes(file.bytes)} · {file.uploadedByEmail ?? 'unknown'} ·{' '}
          {relativeTime(file.createdAt)}
        </div>
      </a>
      <button
        type="button"
        aria-label={`Delete ${file.name}`}
        onClick={onDelete}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--danger-tint)] hover:text-[var(--danger)] focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)] pointer-coarse:min-h-11 pointer-coarse:min-w-11"
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
