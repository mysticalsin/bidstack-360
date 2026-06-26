// NotesPanel — embeddable card that lists, creates, edits, pins, and
// deletes notes for a single customer account. Designed to slot into the
// /accounts/:id cockpit aside without external CSS.
//
// Markdown rendering is intentionally trivial (regex bold/italic only) per
// the spec — we don't want a full markdown lib dependency for a note
// preview surface. Untrusted content is escaped before regex replacement
// to avoid HTML injection from a note body.

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { confirm } from '@/components/ui/ConfirmDialog';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useCreateNote, useDeleteNote, useNotes, useUpdateNote } from '@/hooks/useNotes';
import { relativeTime } from '@/lib/format';
import type { Note } from '@bidstack/shared';
import { MeetingNotesImportDialog } from './MeetingNotesImportDialog';

interface Props {
  accountId: string | undefined;
  companyName?: string;
  domain?: string | null;
}

export function NotesPanel({ accountId, companyName, domain }: Props) {
  const { t } = useTranslation('crm');
  const list = useNotes(accountId);
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Filter out auto-generated meeting import notes with numeric timestamps
  // (e.g. "Meeting Import 1778695956797") — these are noise in the UI.
  const filteredNotes =
    list.data?.items.filter((note) => {
      if (!note.title) return true;
      const isNumericImport = /Meeting\s*Import\s*\d{10,}/i.test(note.title);
      return !isNumericImport;
    }) ?? [];

  return (
    <Card>
      <SectionHeader
        title={t('notes.panelTitle', 'Notes')}
        caption={t('notes.accessScoped', 'Access follows account groups')}
        action={
          accountId && !composing ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <MeetingNotesImportDialog
                accountId={accountId}
                companyName={companyName}
                domain={domain}
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setComposing(true);
                  setEditingId(null);
                }}
              >
                {t('notes.addButton', '+ Add')}
              </Button>
            </div>
          ) : null
        }
      />

      <div className="px-5 py-4">
        {composing && accountId ? (
          <NoteEditor
            accountId={accountId}
            onDone={() => setComposing(false)}
            onCancel={() => setComposing(false)}
          />
        ) : null}

        {!accountId ? (
          <EmptyState
            title={t('notes.noAccountTitle', 'Select an account to view notes')}
            message={t('notes.noAccountMessage', 'Notes are attached to a customer account.')}
          />
        ) : list.isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : list.isError ? (
          <ErrorState
            title={t('notes.loadErrorTitle', "Couldn't load notes")}
            message={
              list.error instanceof Error
                ? list.error.message
                : t('notes.unknownError', 'Unknown error')
            }
          />
        ) : filteredNotes.length === 0 ? (
          <EmptyState
            title={t('notes.emptyTitle', 'No notes yet')}
            message={t('notes.emptyMessage', 'Capture a meeting summary or context.')}
          />
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {filteredNotes.map((note) =>
              editingId === note.id ? (
                <li key={note.id} className="py-3">
                  <NoteEditor
                    accountId={accountId}
                    initial={note}
                    onDone={() => setEditingId(null)}
                    onCancel={() => setEditingId(null)}
                  />
                </li>
              ) : (
                <NoteRow
                  key={note.id}
                  note={note}
                  accountId={accountId}
                  onEdit={() => setEditingId(note.id)}
                />
              ),
            )}
          </ul>
        )}
      </div>
    </Card>
  );
}

interface RowProps {
  note: Note;
  accountId: string;
  onEdit: () => void;
}

function NoteRow({ note, accountId, onEdit }: RowProps) {
  const { t } = useTranslation('crm');
  const update = useUpdateNote(accountId);
  const remove = useDeleteNote(accountId);
  const togglePin = () => update.mutate({ id: note.id, patch: { pinned: !note.pinned } });
  const onDelete = async () => {
    // Rule 13 — destructive op needs explicit acknowledgement. The custom
    // confirm dialog also gives a destructive-styled action and keyboard
    // dismiss, both of which window.confirm cannot.
    const ok = await confirm({
      title: t('notes.deleteConfirmTitle', 'Delete this note?'),
      description: t(
        'notes.deleteConfirmDescription',
        'The note will be removed from this account. The audit log keeps a record of the deletion.',
      ),
      confirmLabel: t('notes.deleteConfirmLabel', 'Delete'),
      destructive: true,
    });
    if (!ok) return;
    remove.mutate(note.id, {
      onSuccess: () => toast.success(t('notes.deleteSuccess', 'Note deleted')),
      onError: (err) =>
        toast.error(t('notes.deleteErrorTitle', 'Delete failed'), {
          description:
            err instanceof Error
              ? err.message
              : t('notes.serverRejected', 'The server rejected the request.'),
        }),
    });
  };

  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-[var(--fg-primary)] truncate">
              {note.title}
            </h4>
            {note.pinned ? <Badge tone="amber">{t('notes.pinnedBadge', 'Pinned')}</Badge> : null}
          </div>
          <div className="mt-1 text-xs text-[var(--fg-secondary)] line-clamp-3">
            <SafeMarkdownPreview text={note.bodyMd} />
          </div>
          <div className="mt-1.5 text-[11px] text-[var(--fg-tertiary)]">
            {note.authorEmail ?? t('notes.unknownAuthor', 'Unknown')} ·{' '}
            {relativeTime(note.createdAt)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={togglePin}
            disabled={update.isPending}
            aria-label={
              note.pinned
                ? t('notes.unpinAriaLabel', 'Unpin note')
                : t('notes.pinAriaLabel', 'Pin note')
            }
            title={note.pinned ? t('notes.unpinTitle', 'Unpin') : t('notes.pinTitle', 'Pin')}
          >
            {note.pinned ? t('notes.unpinAction', 'Unpin') : t('notes.pinAction', 'Pin')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onEdit}
            aria-label={t('notes.editAriaLabel', 'Edit note')}
            title={t('notes.editTitle', 'Edit')}
          >
            {t('notes.editAction', 'Edit')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            disabled={remove.isPending}
            aria-label={t('notes.deleteAriaLabel', 'Delete note')}
            title={t('notes.deleteTitle', 'Delete')}
            className="text-[var(--danger)]"
          >
            {t('notes.deleteAction', 'Delete')}
          </Button>
        </div>
      </div>
    </li>
  );
}

interface EditorProps {
  accountId: string;
  initial?: Note;
  onDone: () => void;
  onCancel: () => void;
}

function NoteEditor({ accountId, initial, onDone, onCancel }: EditorProps) {
  const { t } = useTranslation('crm');
  const create = useCreateNote(accountId);
  const update = useUpdateNote(accountId);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [bodyMd, setBodyMd] = useState(initial?.bodyMd ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError(t('notes.titleRequired', 'Title is required'));
      return;
    }
    try {
      if (initial) {
        await update.mutateAsync({ id: initial.id, patch: { title: cleanTitle, bodyMd } });
      } else {
        await create.mutateAsync({ title: cleanTitle, bodyMd, pinned: false });
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('notes.saveFailed', 'Save failed'));
    }
  };

  const isPending = create.isPending || update.isPending;

  return (
    <form onSubmit={submit} className="mb-4 space-y-2">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('notes.titlePlaceholder', 'Title')}
        maxLength={200}
        required
        aria-label={t('notes.titleAriaLabel', 'Note title')}
        className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] focus:outline-none focus:ring-2 focus:ring-border-focus"
      />
      <textarea
        value={bodyMd}
        onChange={(e) => setBodyMd(e.target.value)}
        placeholder={t('notes.bodyPlaceholder', 'Markdown supports **bold** and *italic*')}
        rows={4}
        maxLength={32_000}
        aria-label={t('notes.bodyAriaLabel', 'Note body')}
        className="w-full resize-y rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] focus:outline-none focus:ring-2 focus:ring-border-focus"
      />
      {error ? (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={isPending}>
          {t('notes.cancelAction', 'Cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending
            ? t('notes.savingAction', 'Saving…')
            : initial
              ? t('notes.saveAction', 'Save')
              : t('notes.addNoteAction', 'Add note')}
        </Button>
      </div>
    </form>
  );
}

// Safe markdown preview — renders as React nodes without any HTML parsing.
// No dangerouslySetInnerHTML. XSS-safe by construction.
function SafeMarkdownPreview({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          <InlineMarkdownLine line={line} />
          {i < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </>
  );
}

function InlineMarkdownLine({ line }: { line: string }) {
  const parts: React.ReactNode[] = [];
  let remaining = line;
  let key = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/^(.*?)\*\*([^*]+)\*\*(.*)$/);
    const emMatch = remaining.match(/^(.*?)\*([^*]+)\*(.*)$/);

    if (boldMatch && (!emMatch || boldMatch[1]!.length <= emMatch[1]!.length)) {
      if (boldMatch[1]) {
        parts.push(<span key={key++}>{boldMatch[1]}</span>);
      }
      parts.push(<strong key={key++}>{boldMatch[2]}</strong>);
      remaining = boldMatch[3]!;
    } else if (emMatch) {
      if (emMatch[1]) {
        parts.push(<span key={key++}>{emMatch[1]}</span>);
      }
      parts.push(<em key={key++}>{emMatch[2]}</em>);
      remaining = emMatch[3]!;
    } else {
      // eslint-disable-next-line no-useless-assignment
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }
  }

  return <>{parts}</>;
}
