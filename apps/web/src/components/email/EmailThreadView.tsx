// One email thread, oldest first. Provider HTML goes through the allowlist
// sanitizer: scripts and handlers are dropped, remote images are blocked and
// quoted history is collapsed behind a toggle.

import type { EmailThreadMessageDto, EmailThreadResponse } from '@bidstack/shared';
import { useQuery } from '@tanstack/react-query';
import { ImageOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { sanitizeEmailHtml, splitQuotedText } from '@/lib/email/sanitize';
import { api } from '@/lib/api';

const BODY = 'email-body text-sm leading-6 text-[var(--fg-primary)] break-words [&_a]:text-[var(--brand-primary)] [&_a]:underline';

export function EmailThreadView({ threadId }: { threadId: string }) {
  const { t } = useTranslation('crm');
  const thread = useQuery<EmailThreadResponse>({
    queryKey: ['email-thread', threadId],
    queryFn: () => api(`/api/email/threads/${encodeURIComponent(threadId)}`),
  });

  if (thread.isLoading) return <LoadingSkeleton rows={3} />;
  if (thread.isError || !thread.data) {
    return <ErrorState title={t('emailThread.loadError', 'Could not load this thread')} />;
  }
  return (
    <ol className="space-y-4" data-testid="email-thread">
      {thread.data.messages.map((m) => (
        <ThreadMessage key={m.id} message={m} />
      ))}
    </ol>
  );
}

function ThreadMessage({ message }: { message: EmailThreadMessageDto }) {
  const { t } = useTranslation('crm');
  const [showQuoted, setShowQuoted] = useState(false);
  const parts = useMemo(() => {
    if (message.bodyHtml) {
      const s = sanitizeEmailHtml(message.bodyHtml);
      return { html: s.html, quotedHtml: s.quotedHtml, text: null, quotedText: null, blocked: s.blockedImages };
    }
    const s = splitQuotedText(message.bodyText ?? '');
    return { html: null, quotedHtml: null, text: s.body, quotedText: s.quoted, blocked: 0 };
  }, [message.bodyHtml, message.bodyText]);
  const when = message.sentAt ?? message.receivedAt ?? message.createdAt;
  const hasQuoted = Boolean(parts.quotedHtml || parts.quotedText);

  return (
    <li className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-semibold text-[var(--fg-primary)]" title={message.fromEmail}>
          {message.fromEmail}
        </span>
        <time className="shrink-0 text-xs text-[var(--fg-tertiary)]" dateTime={when}>
          {new Date(when).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
        </time>
      </header>
      {parts.html !== null ? (
        <div className={BODY} dangerouslySetInnerHTML={{ __html: parts.html }} />
      ) : (
        <p className={`${BODY} whitespace-pre-wrap`}>{parts.text}</p>
      )}
      {parts.blocked > 0 ? (
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-[var(--fg-tertiary)]">
          <ImageOff size={14} aria-hidden />
          {t('emailThread.imagesBlocked', '{{count}} remote image blocked', { count: parts.blocked })}
        </p>
      ) : null}
      {hasQuoted ? (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={showQuoted}
            onClick={() => setShowQuoted((v) => !v)}
            className="min-h-11 rounded-lg px-2 text-xs font-medium text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
          >
            {showQuoted
              ? t('emailThread.hideQuoted', 'Hide quoted text')
              : t('emailThread.showQuoted', 'Show quoted text')}
          </button>
          {showQuoted ? (
            parts.quotedHtml ? (
              <div
                className={`${BODY} mt-2 border-l-2 border-[var(--border-default)] pl-3 text-[var(--fg-secondary)]`}
                dangerouslySetInnerHTML={{ __html: parts.quotedHtml }}
              />
            ) : (
              <p className={`${BODY} mt-2 whitespace-pre-wrap border-l-2 border-[var(--border-default)] pl-3 text-[var(--fg-secondary)]`}>
                {parts.quotedText}
              </p>
            )
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
