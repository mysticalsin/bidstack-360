import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EditorContent, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import DOMPurify from 'dompurify';

import { AiDisclosureBadge } from '@/components/rfp/shared/AiDisclosureBadge';
import type { ComplianceRow as ComplianceRowData } from '@/hooks/rfp/useRfpCompliance';

interface ComplianceRowProps {
  row: ComplianceRowData;
  onSave: (rowId: string, answerDraft: string) => void;
  isSaving: boolean;
  style?: React.CSSProperties;
}

const STATUS_STYLES: Record<ComplianceRowData['status'], string> = {
  pending: 'bg-[var(--tag-gray-bg)] text-[var(--tag-gray-fg)]',
  compliant: 'bg-[var(--tag-jade-bg)] text-[var(--tag-jade-fg)]',
  partial: 'bg-[var(--tag-amber-bg)] text-[var(--tag-amber-fg)]',
  non_compliant: 'bg-[var(--tag-tomato-bg)] text-[var(--tag-tomato-fg)]',
};

const STATUS_LABELS: Record<ComplianceRowData['status'], string> = {
  pending: 'Pending',
  compliant: 'Compliant',
  partial: 'Partial',
  non_compliant: 'Non-compliant',
};

/**
 * Lazy TipTap editor — only mounts a ProseMirror instance when the row is
 * being edited. WHY: compliance matrices can have 200+ rows; mounting TipTap
 * for every row on load would create 200+ ProseMirror instances and tank
 * render performance. The textarea content is an HTML string stored in
 * answerDraft; TipTap reads and writes it as rich text.
 */
function ComplianceEditorInner({
  initialContent,
  onDone,
  isSaving,
  rowLabel,
}: {
  initialContent: string;
  onDone: (html: string) => void;
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
          'min-h-[72px] p-2 text-xs text-[var(--fg-primary)] focus:outline-none prose prose-xs max-w-none dark:prose-invert',
      },
    },
  });

  return (
    <div className="mt-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] focus-within:ring-1 focus-within:ring-[var(--brand-primary)]">
      <EditorContent editor={editor} />
      <div className="flex justify-end border-t border-[var(--border-subtle)] px-2 py-1">
        <button
          type="button"
          disabled={isSaving}
          onClick={() => {
            if (editor) {
              onDone(editor.getText() ? editor.getHTML() : '');
            }
          }}
          className="min-h-[44px] min-w-[44px] rounded-md px-2 py-1 text-[10px] font-medium text-[var(--brand-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={t('compliance.done')}
        >
          {isSaving ? t('states.saving') : t('compliance.done')}
        </button>
      </div>
    </div>
  );
}

export function ComplianceRow({ row, onSave, isSaving, style }: ComplianceRowProps) {
  const { t } = useTranslation('rfp');
  const [isEditing, setIsEditing] = useState(false);
  const confidencePct = Math.round(row.aiConfidenceBps / 100);

  function handleDone(html: string) {
    onSave(row.id, html);
    setIsEditing(false);
  }

  return (
    <div
      className="flex items-start gap-3 border-b border-[var(--border-subtle)] px-4 py-3"
      style={style}
    >
      {/* Requirement + editable response */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-[var(--fg-primary)] line-clamp-2">
          {row.requirement}
        </p>
        {!isEditing && row.response && (
          // Sanitize TipTap HTML before rendering. Content originates from users/AI
          // but XSS defense-in-depth is mandatory (CSP is not enough for stored HTML).
          <p
            className="mt-1 text-xs text-[var(--fg-secondary)] line-clamp-2 prose prose-xs max-w-none dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(row.response) }}
          />
        )}
        {!isEditing && !row.response && (
          <p className="mt-1 text-xs italic text-[var(--fg-tertiary)]">
            {t('compliance.noResponse')}
          </p>
        )}
        {isEditing && (
          <ComplianceEditorInner
            initialContent={row.response ?? ''}
            onDone={handleDone}
            isSaving={isSaving}
            rowLabel={row.requirement}
          />
        )}
      </div>

      {/* Status badge + AI disclosure + edit toggle */}
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span
          className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold ${STATUS_STYLES[row.status]}`}
          aria-label={`Status: ${STATUS_LABELS[row.status]}`}
        >
          {STATUS_LABELS[row.status]}
        </span>
        {row.autoFilled && (
          // EU AI Act Art. 50 — unambiguous AI disclosure is mandatory for
          // auto-filled compliance answers. The AiDisclosureBadge is always
          // visible when autoFilled=true; it is not behind a toggle.
          <div className="flex flex-col items-end gap-0.5">
            <AiDisclosureBadge />
            <span
              className="text-[10px] text-[var(--fg-tertiary)]"
              aria-label={`AI confidence: ${confidencePct}%`}
            >
              {confidencePct}% confidence
            </span>
          </div>
        )}
        {/* Only show the Edit toggle when not actively editing (Done is inside the editor) */}
        {!isEditing && (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="min-h-[44px] min-w-[44px] rounded-md px-2 py-1 text-[10px] font-medium text-[var(--brand-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            aria-label={t('compliance.edit')}
          >
            {t('compliance.edit')}
          </button>
        )}
      </div>
    </div>
  );
}
