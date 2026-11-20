// Compose an email draft. Drafts stay in Polo: there is no send path here.
// After saving, the user copies the text or opens their own mail app.

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { api } from '@/lib/api';

/** Pinned in tests: the composer must never imply that it sends. */
export const DRAFT_ONLY_COPY = 'Saved as a draft in Polo. Nothing is sent.';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIELD =
  'w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-page)] px-3 py-2 text-sm text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]';
const LABEL = 'block text-sm font-medium text-[var(--fg-secondary)] mb-1';

export interface DraftLink {
  contactId?: string;
  companyId?: string;
  opportunityId?: string;
}

interface DraftComposerProps {
  defaultTo?: string;
  defaultSubject?: string;
  threadId?: string;
  link: DraftLink;
  onClose: () => void;
}

function parseRecipients(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function DraftComposer({ defaultTo, defaultSubject, threadId, link, onClose }: DraftComposerProps) {
  const { t } = useTranslation('crm');
  const [to, setTo] = useState(defaultTo ?? '');
  const [subject, setSubject] = useState(defaultSubject ?? '');
  const [text, setText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // One key per composer, so a double click or a retry saves one draft.
  const [clientRequestId] = useState(() => crypto.randomUUID());

  const save = useMutation({
    mutationFn: (recipients: string[]) =>
      api<{ id: string }>('/api/email/drafts', {
        method: 'POST',
        body: {
          to: recipients.map((email) => ({ email })),
          subject,
          text: text || undefined,
          threadId,
          ...link,
          clientRequestId,
        },
      }),
  });

  function onSave() {
    const recipients = parseRecipients(to);
    if (recipients.length === 0 || recipients.some((r) => !EMAIL_RE.test(r))) {
      setFormError(t('emailDraft.badRecipient', 'Enter a valid email address.'));
      return;
    }
    setFormError(null);
    save.mutate(recipients);
  }

  const mailto = `mailto:${parseRecipients(to).map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${text}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  // The API returns the original draft for a reused clientRequestId, so a saved
  // draft cannot be updated; lock the fields so Copy and the mail app match it.
  const saved = save.isSuccess;

  const error =
    formError ??
    (save.isError ? t('emailDraft.saveError', 'Could not save the draft. Try again.') : null);

  return (
    <Modal open onClose={onClose} title={t('emailDraft.title', 'New draft')}>
      <div className="w-full max-w-lg mx-4 space-y-4 rounded-2xl bg-[var(--surface-card)] p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-[var(--fg-primary)]">
          {t('emailDraft.title', 'New draft')}
        </h2>
        <p className="text-xs text-[var(--fg-tertiary)]">{t('emailDraft.draftOnly', DRAFT_ONLY_COPY)}</p>
        {error ? (
          <p role="alert" className="rounded-lg border border-[var(--danger)] px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}
        <div>
          <label htmlFor="draft-to" className={LABEL}>
            {t('emailDraft.to', 'To')}
          </label>
          <input
            id="draft-to"
            type="text"
            value={to}
            readOnly={saved}
            onChange={(e) => setTo(e.target.value)}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="draft-subject" className={LABEL}>
            {t('emailDraft.subject', 'Subject')}
          </label>
          <input
            id="draft-subject"
            type="text"
            maxLength={998}
            value={subject}
            readOnly={saved}
            onChange={(e) => setSubject(e.target.value)}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="draft-text" className={LABEL}>
            {t('emailDraft.message', 'Message')}
          </label>
          <textarea
            id="draft-text"
            rows={8}
            value={text}
            readOnly={saved}
            onChange={(e) => setText(e.target.value)}
            className={FIELD}
          />
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {saved ? (
            <>
              <span role="status" className="mr-auto self-center text-sm text-[var(--fg-secondary)]">
                {t('emailDraft.saved', 'Draft saved')}
              </span>
              <Button variant="secondary" onClick={() => void onCopy()}>
                {copied ? t('emailDraft.copied', 'Copied') : t('emailDraft.copy', 'Copy')}
              </Button>
              <a
                href={mailto}
                className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-medium text-[var(--brand-primary)] hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
              >
                {t('emailDraft.openMailApp', 'Open in mail app')}
              </a>
              <Button variant="ghost" onClick={onClose}>
                {t('emailDraft.done', 'Done')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                {t('emailDraft.cancel', 'Cancel')}
              </Button>
              <Button onClick={onSave} disabled={save.isPending}>
                {save.isPending ? t('emailDraft.saving', 'Saving…') : t('emailDraft.save', 'Save draft')}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
