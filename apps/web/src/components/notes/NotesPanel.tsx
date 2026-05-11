// NotesPanel — embeddable card that lists, creates, edits, pins, and
// deletes notes for a single customer account. Designed to slot into the
// /accounts/:id cockpit aside without external CSS.
//
// Markdown rendering is intentionally trivial (regex bold/italic only) per
// the spec — we don't want a full markdown lib dependency for a note
// preview surface. Untrusted content is escaped before regex replacement
// to avoid HTML injection from a note body.

import { useState, type FormEvent } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { confirm } from '@/components/ui/ConfirmDialog';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useCreateNote, useDeleteNote, useNotes, useUpdateNote } from '@/hooks/useNotes';
import { relativeTime } from '@/lib/format';
import type { Note } from '@bidstack/shared';

interface Props {
  accountId: string | undefined;
}

export function NotesPanel({ accountId }: Props) {
  const list = useNotes(accountId);
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <Card>
      <SectionHeader
        title="Notes"
        action={
          accountId && !composing ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setComposing(true);
                setEditingId(null);
              }}
            >
              + Add
            </Button>
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
            title="Select an account to view notes"
            message="Notes are attached to a customer account."
          />
        ) : list.isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : list.isError ? (
          <ErrorState
            title="Couldn't load notes"
            message={list.error instanceof Error ? list.error.message : 'Unknown error'}
          />
        ) : !list.data || list.data.items.length === 0 ? (
          <EmptyState title="No notes yet" message="Capture a meeting summary or context." />
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {list.data.items.map((note) =>
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
  const update = useUpdateNote(accountId);
  const remove = useDeleteNote(accountId);
  const togglePin = () => update.mutate({ id: note.id, patch: { pinned: !note.pinned } });
  const onDelete = async () => {
    // Rule 13 — destructive op needs explicit acknowledgement. The custom
    // confirm dialog also gives a destructive-styled action and keyboard
    // dismiss, both of which window.confirm cannot.
    const ok = await confirm({
      title: 'Delete this note?',
      description:
        'The note will be removed from this account. The audit log keeps a record of the deletion.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    remove.mutate(note.id, {
      onSuccess: () => toast.success('Note deleted'),
      onError: (err) =>
        toast.error('Delete failed', {
          description: err instanceof Error ? err.message : 'The server rejected the request.',
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
            {note.pinned ? <Badge tone="amber">Pinned</Badge> : null}
          </div>
          <div
            className="mt-1 text-xs text-[var(--fg-secondary)] line-clamp-3"
            dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(note.bodyMd) }}
          />
          <div className="mt-1.5 text-[11px] text-[var(--fg-tertiary)]">
            {note.authorEmail ?? 'Unknown'} · {relativeTime(note.createdAt)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={togglePin}
            disabled={update.isPending}
            aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
            title={note.pinned ? 'Unpin' : 'Pin'}
          >
            {note.pinned ? 'Unpin' : 'Pin'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onEdit} aria-label="Edit note" title="Edit">
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            disabled={remove.isPending}
            aria-label="Delete note"
            title="Delete"
            className="text-[var(--danger)]"
          >
            Delete
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
      setError('Title is required');
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
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const isPending = create.isPending || update.isPending;

  return (
    <form onSubmit={submit} className="mb-4 space-y-2">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        maxLength={200}
        required
        aria-label="Note title"
        className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]"
      />
      <textarea
        value={bodyMd}
        onChange={(e) => setBodyMd(e.target.value)}
        placeholder="Markdown supports **bold** and *italic*"
        rows={4}
        maxLength={32_000}
        aria-label="Note body"
        className="w-full resize-y rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]"
      />
      {error ? (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? 'Saving…' : initial ? 'Save' : 'Add note'}
        </Button>
      </div>
    </form>
  );
}

// Trivial markdown preview. Escapes HTML first so untrusted content can't
// inject tags, then applies **bold** and *italic*. Anything more elaborate
// (lists, links) belongs behind a real parser when we add a markdown lib.
function renderInlineMarkdown(input: string): string {
  const escaped = input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return escaped
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br />');
}
