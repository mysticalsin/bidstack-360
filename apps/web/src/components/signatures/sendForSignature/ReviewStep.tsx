// Step 3: preview document, compose message, review recipients, and send.
import { useDocumentTemplate } from '@/hooks/useDocumentTemplates';
import { DocumentPreviewIframe } from '../DocumentPreviewIframe';
import { cn } from '@/lib/cn';
import { type Recipient, FieldLabel, inputClass } from './signatureModalShared';

interface Props {
  templateId: string;
  recipients: Recipient[];
  variables: Record<string, string>;
  message: string;
  onChangeMessage: (m: string) => void;
  onBack: () => void;
  onSend: () => void;
  isSending: boolean;
}

export function ReviewStep({
  templateId,
  recipients,
  variables,
  message,
  onChangeMessage,
  onBack,
  onSend,
  isSending,
}: Props) {
  const { data: template } = useDocumentTemplate(templateId);

  // Substitute variables into template body for the live preview.
  const previewHtml = template
    ? Object.entries(variables).reduce(
        (html, [k, v]) => html.replaceAll(`{{${k}}}`, v),
        template.bodyHtml,
      )
    : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Document preview */}
      {previewHtml && (
        <DocumentPreviewIframe
          src={previewHtml}
          srcdoc
          title={template?.name ?? 'Document preview'}
          height={300}
        />
      )}

      {/* Optional message to recipients */}
      <div>
        <FieldLabel htmlFor="sig-message">Message to recipients (optional)</FieldLabel>
        <textarea
          id="sig-message"
          value={message}
          onChange={(e) => onChangeMessage(e.target.value)}
          placeholder="Please review and sign the attached document…"
          rows={3}
          maxLength={500}
          className={cn(inputClass, 'min-h-[auto] resize-none')}
        />
        <p className="mt-0.5 text-right text-xs text-[var(--fg-tertiary)]">{message.length}/500</p>
      </div>

      {/* Recipient summary */}
      <div className="rounded-xl border border-[var(--border-subtle)] p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          Recipients ({recipients.length})
        </p>
        <ul className="flex flex-col gap-1.5" aria-label="Recipient summary">
          {recipients.map((r) => (
            <li key={r.email} className="flex items-center gap-2 text-sm">
              <span className="font-medium text-[var(--fg-primary)]">{r.name}</span>
              <span className="text-[var(--fg-secondary)]">{r.email}</span>
              <span className="ml-auto rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-xs text-[var(--fg-tertiary)]">
                {r.role}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={isSending}
          className={cn(
            'min-h-[44px] rounded-lg border border-[var(--border-default)] px-4 text-sm text-[var(--fg-secondary)]',
            'hover:bg-[var(--surface-sunken)] transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
            'disabled:opacity-40',
          )}
        >
          Back
        </button>
        <button
          type="button"
          onClick={onSend}
          disabled={isSending}
          aria-busy={isSending}
          className={cn(
            'min-h-[44px] rounded-lg bg-brand px-4 text-sm font-medium text-fg-on-brand',
            'hover:bg-brand-hover transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          {isSending ? 'Sending…' : 'Send for Signature'}
        </button>
      </div>
    </div>
  );
}
