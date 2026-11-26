// CollaborativeNotesSection — a CRDT-backed rich-text notes section.
//
// This component provides a collaborative rich-text notes field for an entity.
// It stores content in the YjsDocument system (not the Note API) so multiple
// users can edit the same entity's notes simultaneously without conflicts.
//
// WHY separate from the Note API records:
//   Note records are discrete entries with timestamps, authors, and pinning.
//   Collaborative notes is a single live document — closer to Notion's
//   page body — allowing free-form rich text with real-time co-editing.
//   Both coexist: this component is the "scratch pad" surface; the notes
//   sidebar remains for structured threaded notes.

import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/StateMessages';
import { useYjsField } from '@/hooks/useYjsField';
import { useUser } from '@/lib/auth';

import { collaborativeNotesPhase, type CollaborativeNotesPhase } from './collaborative-notes-read';

// Tiptap + Y.js are heavy (~hundreds of KB) and only mount on the three detail
// pages, below the fold. Lazy-loading splits them into their own async chunk so
// they no longer inflate the initial detail-page bundle.
const CollaborativeRichTextEditor = lazy(() =>
  import('./CollaborativeRichTextEditor').then((m) => ({
    default: m.CollaborativeRichTextEditor,
  })),
);

interface Props {
  entityType: 'opportunity' | 'contact' | 'lead';
  entityId: string | undefined;
  /** Defaults to 'notes'. Use 'description' for proposal body fields. */
  fieldKey?: string;
  label?: string;
  readOnly?: boolean;
}

export function CollaborativeNotesSection(props: Props) {
  const [attempt, setAttempt] = useState(0);
  return (
    <CollaborativeNotesBody
      key={`${attempt}:${props.entityId ?? ''}:${props.fieldKey ?? 'notes'}`}
      {...props}
      onRetry={() => setAttempt((n) => n + 1)}
    />
  );
}

function CollaborativeNotesBody({
  entityType,
  entityId,
  fieldKey = 'notes',
  label,
  readOnly = false,
  onRetry,
}: Props & { onRetry: () => void }) {
  const { user } = useUser();
  const { t } = useTranslation('crm');
  const [latch, setLatch] = useState<Extract<CollaborativeNotesPhase, 'empty' | 'ready'> | null>(
    null,
  );

  // Once the document has arrived, this observer steps aside so the editor
  // owns the only socket. A missing payload stays unread and does not open
  // the pad.
  const field = useYjsField({
    entityType,
    entityId,
    fieldKey,
    enabled: Boolean(entityId) && latch === null,
  });
  const text = field.yText == null ? null : field.yText.toString();
  const live = collaborativeNotesPhase({ text, connectionState: field.connectionState });
  if (latch === null && (live === 'empty' || live === 'ready')) {
    setLatch(live);
  }
  const phase = latch ?? live;

  const heading = label ?? t('collaborativeNotes.heading', 'Live collaboration');
  const headingId = `collab-notes-${entityId ?? 'loading'}`;

  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="text-sm font-semibold text-[var(--fg-secondary)] uppercase tracking-wider mb-2"
      >
        {heading}
        <span className="ml-2 text-xs font-normal text-[var(--fg-tertiary)] normal-case">
          {t('collaborativeNotes.realTimeBadge', '· real-time')}
        </span>
      </h2>

      {phase === 'unread' ? (
        <p role="status" aria-busy="true" className="text-sm text-[var(--fg-secondary)]">
          {t('collaborativeNotes.checking', 'Checking collaborative notes. They have not arrived.')}
        </p>
      ) : null}

      {phase === 'failed' ? (
        <ErrorState
          title={t('collaborativeNotes.loadErrorTitle', "Couldn't load collaborative notes")}
          message={t('collaborativeNotes.loadErrorMessage', 'The notes did not load.')}
          action={
            <Button size="sm" variant="secondary" onClick={onRetry}>
              {t('collaborativeNotes.retry', 'Retry')}
            </Button>
          }
        />
      ) : null}

      {phase === 'empty' || phase === 'ready' ? (
        <Suspense
          fallback={
            <div
              className="min-h-[8rem] animate-pulse rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)]"
              aria-busy="true"
              aria-label={t('collaborativeNotes.loadingEditor', 'Loading editor')}
            />
          }
        >
          <CollaborativeRichTextEditor
            yjsOptions={{
              entityType,
              entityId,
              fieldKey,
              enabled: Boolean(entityId),
            }}
            userName={user?.fullName ?? undefined}
            userId={user?.id ?? undefined}
            placeholder={
              phase === 'empty'
                ? t('collaborativeNotes.placeholder', 'Start writing collaborative notes…')
                : undefined
            }
            readOnly={readOnly || !entityId}
            className="min-h-[8rem]"
          />
        </Suspense>
      ) : null}
    </section>
  );
}
