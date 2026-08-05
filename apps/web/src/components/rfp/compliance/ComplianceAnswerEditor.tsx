// The lazy TipTap editor for one compliance answer.
//
// Extracted from ComplianceRow when the row became a table row: a ProseMirror
// instance cannot live inside a dense <td> without breaking the grid, so it now
// renders in the row's expanded detail panel. The laziness is the point and is
// unchanged — a 200-row matrix must never mount 200 editors, so this component
// is only rendered while a row is actually being edited.

import { useTranslation } from 'react-i18next';
import { EditorContent, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';

import { Button } from '@/components/ui/Button';

export function ComplianceAnswerEditor({
  initialContent,
  onDone,
  onCancel,
  isSaving,
  rowLabel,
}: {
  initialContent: string;
  onDone: (html: string) => void;
  onCancel: () => void;
  isSaving: boolean;
  rowLabel: string;
}) {
  const { t } = useTranslation('rfp');

  const editor = useEditor({
    extensions: [StarterKit],
    content: initialContent || '',
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': `Edit response for: ${rowLabel}`,
        class:
          'min-h-[72px] p-2 text-xs text-fg-primary focus:outline-none prose prose-xs max-w-none dark:prose-invert',
      },
    },
  });

  return (
    <div className="rounded-md border border-border-subtle bg-surface-card focus-within:ring-1 focus-within:ring-[var(--brand-primary)]">
      <EditorContent editor={editor} />
      <div className="flex justify-end gap-1 border-t border-border-subtle px-2 py-1">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSaving}>
          {t('compliance.cancel', 'Cancel')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={isSaving}
          onClick={() => {
            if (editor) onDone(editor.getText() ? editor.getHTML() : '');
          }}
          aria-label={t('compliance.done', 'Done')}
        >
          {isSaving ? t('states.saving', 'Saving…') : t('compliance.done', 'Done')}
        </Button>
      </div>
    </div>
  );
}
