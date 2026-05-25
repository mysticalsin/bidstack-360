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

import { useUser } from '@/lib/auth';
import { CollaborativeRichTextEditor } from './CollaborativeRichTextEditor';

interface Props {
  entityType: 'opportunity' | 'contact' | 'lead';
  entityId: string | undefined;
  /** Defaults to 'notes'. Use 'description' for proposal body fields. */
  fieldKey?: string;
  label?: string;
  readOnly?: boolean;
}

export function CollaborativeNotesSection({
  entityType,
  entityId,
  fieldKey = 'notes',
  label = 'Collaborative Notes',
  readOnly = false,
}: Props) {
  const { user } = useUser();

  return (
    <section aria-labelledby={`collab-notes-${entityId ?? 'loading'}`}>
      <h2
        id={`collab-notes-${entityId ?? 'loading'}`}
        className="text-sm font-semibold text-[var(--fg-secondary)] uppercase tracking-wider mb-2"
      >
        {label}
        <span className="ml-2 text-xs font-normal text-[var(--fg-tertiary)] normal-case">
          · real-time
        </span>
      </h2>

      <CollaborativeRichTextEditor
        yjsOptions={{
          entityType,
          entityId,
          fieldKey,
          enabled: Boolean(entityId),
        }}
        userName={user?.fullName ?? undefined}
        userId={user?.id ?? undefined}
        placeholder="Start writing collaborative notes…"
        readOnly={readOnly || !entityId}
        className="min-h-[8rem]"
      />
    </section>
  );
}
