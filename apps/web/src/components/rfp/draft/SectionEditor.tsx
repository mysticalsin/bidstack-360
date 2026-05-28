import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

import { AiDisclosureBadge } from '@/components/rfp/shared/AiDisclosureBadge';
import type { DraftSection } from '@/hooks/rfp/useRfpDraft';

interface SectionEditorProps {
  section: DraftSection;
  onSave: (content: string) => void;
  isSaving: boolean;
}

export function SectionEditor({ section, onSave, isSaving }: SectionEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: section.content,
    editorProps: {
      attributes: {
        // Accessible rich text editor region
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': `Edit section: ${section.title}`,
        class: [
          'min-h-[120px] p-3 text-sm text-[var(--fg-primary)] focus:outline-none',
          'prose prose-sm max-w-none dark:prose-invert',
        ].join(' '),
      },
    },
  });

  const handleSave = () => {
    if (!editor) return;
    onSave(editor.getHTML());
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{section.title}</h3>
        {section.aiGenerated && <AiDisclosureBadge />}
      </div>
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] focus-within:border-[var(--brand-primary)] focus-within:ring-1 focus-within:ring-[var(--brand-primary)]">
        <EditorContent editor={editor} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--fg-tertiary)]">
          {section.humanReviewed ? '✓ Reviewed' : 'Not yet reviewed'}
        </span>
        <button
          type="button"
          disabled={isSaving}
          onClick={handleSave}
          className="min-h-[44px] rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-primary)]/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? 'Saving…' : 'Save & Mark Reviewed'}
        </button>
      </div>
    </div>
  );
}
