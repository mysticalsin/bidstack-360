// CollaborativeRichTextEditor — Tiptap editor bound to a Y.js CRDT document.
//
// WHY Tiptap over Lexical:
//   Tiptap ships first-party @tiptap/extension-collaboration and
//   @tiptap/extension-collaboration-cursor built on y-prosemirror, giving us
//   conflict-free collaborative editing with per-user cursor highlights
//   out of the box. Lexical's Y.js integration is community-maintained and
//   less battle-tested at this stack version.
//
// Accessibility:
//   - The editor root is role="textbox" aria-multiline="true" (ProseMirror default).
//   - Remote cursor labels are announced via an aria-live="polite" region with
//     2-second debounce to avoid overwhelming screen readers.
//   - prefers-reduced-motion disables cursor-glide animation.
//   - WCAG 2.2 AA contrast on all UI text (cursor labels: bg is user colour,
//     text is white — checked at ≥ 4.5:1 for the default palette).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useReducedMotion } from 'framer-motion';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import { useYjsField, type UseYjsFieldOptions } from '@/hooks/useYjsField';
import type { RemoteCursor, ConnectionState } from '@/lib/yjs-client';

// ─── Cursor colours pool ──────────────────────────────────────────────────
// Deterministic colour per user so it stays stable across reconnects.
// These are literal hex on purpose: a collaborator's colour travels over the
// wire and must render identically for every client in either theme, so it
// cannot be a theme token. Each hue sits in the luminance band where WHITE
// label text is ≥ 4.5:1 AND the caret keeps ≥ 3:1 against both the white and
// the near-black editor surface (the previous 500-weight pool failed the
// white-label check on 6 of 8 hues).

const CURSOR_COLORS = [
  '#4f46e5', // indigo — white 6.3:1
  '#db2777', // pink — white 4.6:1
  '#b45309', // amber — white 5.0:1
  '#047857', // emerald — white 5.5:1
  '#2563eb', // blue — white 5.2:1
  '#7c3aed', // violet — white 5.7:1
  '#dc2626', // red — white 4.8:1
  '#0f766e', // teal — white 5.5:1
];

function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length] ?? CURSOR_COLORS[0]!;
}

// ─── Props ────────────────────────────────────────────────────────────────

export interface CollaborativeRichTextEditorProps {
  /** All fields required for Y.js field binding. */
  yjsOptions: UseYjsFieldOptions;
  /** Display name of the local user (shown on cursor label). */
  userName?: string;
  /** Local user's ID (used to skip rendering own cursor). */
  userId?: string;
  /** Called when the editor content changes. Receives HTML string. */
  onChange?: (html: string) => void;
  /** Placeholder text shown when the editor is empty. */
  placeholder?: string;
  /** Additional CSS classes applied to the container. */
  className?: string;
  /** Whether the editor is in read-only mode. */
  readOnly?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────

export function CollaborativeRichTextEditor({
  yjsOptions,
  userName = 'Anonymous',
  userId,
  onChange,
  placeholder,
  className = '',
  readOnly = false,
}: CollaborativeRichTextEditorProps) {
  const { t } = useTranslation('crm');
  const reducedMotion = useReducedMotion();

  const localColor = useMemo(() => colorForUser(userId ?? userName), [userId, userName]);

  const { yText, ydoc, connectionState, remoteCursors, setCursor } = useYjsField({
    ...yjsOptions,
    cursorColor: localColor,
    cursorName: userName,
  });

  const extensions = useMemo(() => {
    if (!ydoc) return [StarterKit];

    return [
      // WHY history: false — Y.js handles undo/redo natively via UndoManager.
      StarterKit.configure({ undoRedo: false }),
      Collaboration.configure({ document: ydoc }),
      CollaborationCursor.configure({
        provider: {
          // Minimal provider shim — CollaborationCursor only needs awareness.
          awareness: createAwarenessShim(remoteCursors),
        },
        user: { name: userName, color: localColor },
      }),
    ];
    // Remote cursors change frequently; we only rebuild extensions when ydoc changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ydoc, userName, localColor]);

  const editor = useEditor({
    extensions,
    editable: !readOnly,
    onUpdate: ({ editor: e }) => {
      onChange?.(e.getHTML());
    },
    onSelectionUpdate: ({ editor: e }) => {
      const { from, to } = e.state.selection;
      setCursor(from, to);
    },
  });

  // Re-sync editable state when readOnly prop changes.
  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  // ─── Accessibility: debounced cursor announcements ─────────────────────

  const [liveRegionText, setLiveRegionText] = useState('');
  const announcementTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (remoteCursors.length === 0) return;
    if (announcementTimer.current) clearTimeout(announcementTimer.current);

    // 2-second debounce — avoids announcing every keypress from collaborators.
    announcementTimer.current = setTimeout(() => {
      const names = remoteCursors.map((c) => c.name).join(', ');
      setLiveRegionText(
        remoteCursors.length === 1
          ? t('collaborativeRichTextEditor.editingAnnouncementOne', '{{names}} is editing', {
              names,
            })
          : t('collaborativeRichTextEditor.editingAnnouncementOther', '{{names}} are editing', {
              names,
            }),
      );
    }, 2_000);

    return () => {
      if (announcementTimer.current) clearTimeout(announcementTimer.current);
    };
  }, [remoteCursors, t]);

  // ─── Connection status badge ───────────────────────────────────────────

  const statusLabel = statusBadgeLabel(connectionState, t);

  return (
    <div className={`collaborative-editor relative ${className}`} data-connection={connectionState}>
      {/* Screen-reader live region for cursor announcements. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {liveRegionText}
      </div>

      {/* Toolbar placeholder — extend with Bold/Italic/etc. as needed. */}
      <div className="flex items-center justify-between mb-1 min-h-[24px]">
        {remoteCursors.length > 0 && (
          <div className="flex items-center gap-1" aria-hidden="true">
            {remoteCursors.map((cursor) => (
              <CursorBadge
                key={cursor.userId}
                cursor={cursor}
                reducedMotion={reducedMotion ?? false}
              />
            ))}
          </div>
        )}
        <ConnectionBadge label={statusLabel} state={connectionState} />
      </div>

      {/* Editor surface */}
      <div
        className={[
          'prose prose-sm dark:prose-invert max-w-none',
          'border border-[var(--border-default)] rounded-md p-3',
          'focus-within:ring-2 focus-within:ring-[var(--ring)] focus-within:ring-offset-1',
          'bg-[var(--surface-card)] text-[var(--text-primary)]',
          readOnly ? 'opacity-60 pointer-events-none' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {!yText &&
          // Shown while Y.Doc is loading: the caller's placeholder text if
          // provided, otherwise shimmer text lines from the shared skeleton
          // system (never a bare "Loading…" string).
          (placeholder ? (
            <p className="text-[var(--text-muted)] text-sm pointer-events-none select-none">
              {placeholder}
            </p>
          ) : (
            <div
              className="space-y-2"
              aria-busy="true"
              aria-live="polite"
              aria-label={t('collaborativeRichTextEditor.loading', 'Loading…')}
            >
              <span className="bs-shimmer block h-3 w-3/4" aria-hidden />
              <span className="bs-shimmer block h-3 w-full" aria-hidden />
              <span className="bs-shimmer block h-3 w-2/3" aria-hidden />
            </div>
          ))}
        {yText && <EditorContent editor={editor} />}
      </div>

      {/* CSS: cursor glide animation — disabled when prefers-reduced-motion */}
      <style>{cursorStyles(reducedMotion ?? false)}</style>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function CursorBadge({ cursor, reducedMotion }: { cursor: RemoteCursor; reducedMotion: boolean }) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5',
        'text-white text-xs font-medium leading-tight',
        !reducedMotion ? 'transition-all duration-300' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ backgroundColor: cursor.color }}
      title={cursor.name}
    >
      <span className="block w-1.5 h-1.5 rounded-full bg-white opacity-80" aria-hidden="true" />
      {cursor.name}
    </span>
  );
}

function ConnectionBadge({ label, state }: { label: string; state: ConnectionState }) {
  // Theme tokens only — the semantic fg tokens already flip per theme, so no
  // dark: mirrors (and no raw palette classes that ignore data-theme).
  const colors: Record<ConnectionState, string> = {
    connected: 'text-[var(--success-fg)]',
    connecting: 'text-[var(--warning-fg)]',
    disconnected: 'text-[var(--text-muted)]',
    error: 'text-[var(--fg-error)]',
  };

  return (
    <span className={`ml-auto text-xs ${colors[state]}`} aria-live="polite">
      {label}
    </span>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function statusBadgeLabel(state: ConnectionState, t: TFunction): string {
  switch (state) {
    case 'connected':
      return t('collaborativeRichTextEditor.statusLive', 'Live');
    case 'connecting':
      return t('collaborativeRichTextEditor.statusConnecting', 'Connecting…');
    case 'disconnected':
      return t('collaborativeRichTextEditor.statusOffline', 'Offline');
    case 'error':
      return t('collaborativeRichTextEditor.statusError', 'Error');
  }
}

/**
 * Minimal awareness shim for CollaborationCursor.
 * The extension reads awareness.getStates() to render other users' cursors.
 * Our YjsClient propagates cursors via Redis Pub/Sub, so we keep a local map
 * updated from the onCursor callback and expose it here.
 */
function createAwarenessShim(cursors: RemoteCursor[]) {
  const states = new Map<number, { user: { name: string; color: string } }>();
  cursors.forEach((c, i) => {
    states.set(i, { user: { name: c.name, color: c.color } });
  });

  return {
    getStates: () => states,
    on: () => {
      /* no-op: updates come via re-render */
    },
    off: () => {
      /* no-op */
    },
  };
}

function cursorStyles(reducedMotion: boolean): string {
  return `
    .collaborative-editor .ProseMirror {
      outline: none;
      min-height: 5rem;
    }
    .collaborative-editor .ProseMirror p.is-editor-empty:first-child::before {
      content: attr(data-placeholder);
      float: left;
      color: var(--text-muted, #9ca3af);
      pointer-events: none;
      height: 0;
    }
    /* Collaboration cursor caret */
    .collaborative-editor .collaboration-cursor__caret {
      border-left: 2px solid;
      border-right: 2px solid;
      margin-left: -1px;
      margin-right: -1px;
      word-break: normal;
      pointer-events: none;
      position: relative;
      ${!reducedMotion ? 'transition: left 0.1s ease, top 0.1s ease;' : ''}
    }
    .collaborative-editor .collaboration-cursor__label {
      border-radius: 3px 3px 3px 0;
      color: #fff;
      font-size: 10px;
      font-weight: 600;
      left: -1px;
      line-height: 1;
      padding: 0.1rem 0.3rem;
      position: absolute;
      top: -1.4em;
      user-select: none;
      white-space: nowrap;
    }
  `;
}
