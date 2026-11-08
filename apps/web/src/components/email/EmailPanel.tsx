// Emails filed on a contact, company or opportunity, one row per thread.
// Opening a row shows the thread; "New draft" composes a Polo-only draft.

import type { EmailListResponse, EmailMessageDto } from '@bidstack/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, PenLine } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Sheet, SheetContent } from '@/components/ui/Sheet';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { DraftComposer, type DraftLink } from './DraftComposer';
import { EmailThreadView } from './EmailThreadView';

const LIMIT = 25;

interface EmailPanelProps {
  filter: DraftLink;
  defaultTo?: string;
}

/** Newest message per thread, newest thread first. */
function latestPerThread(messages: EmailMessageDto[]): EmailMessageDto[] {
  const seen = new Set<string>();
  const out: EmailMessageDto[] = [];
  for (const m of messages) {
    const key = m.threadId ?? m.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

export function EmailPanel({ filter, defaultTo }: EmailPanelProps) {
  const { t } = useTranslation('crm');
  const [open, setOpen] = useState<EmailMessageDto | null>(null);
  const [composing, setComposing] = useState(false);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) if (v) qs.set(k, v);
  qs.set('limit', String(LIMIT));
  const path = `/api/email/messages?${qs.toString()}`;

  const list = useInfiniteQuery({
    queryKey: ['email-messages', path],
    queryFn: ({ pageParam }) =>
      api<EmailListResponse>(pageParam > 1 ? `${path}&page=${pageParam}` : path),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length + 1 : undefined),
    staleTime: 60_000,
  });
  const threads = useMemo(
    () => latestPerThread(list.data?.pages.flatMap((p) => p.messages) ?? []),
    [list.data],
  );

  return (
    <Card data-testid="email-panel">
      <SectionHeader
        title={t('emailPanel.title', 'Email')}
        action={
          <Button size="sm" variant="secondary" onClick={() => setComposing(true)}>
            <PenLine size={14} aria-hidden />
            {t('emailPanel.newDraft', 'New draft')}
          </Button>
        }
      />
      {list.isLoading ? (
        <div className="p-5">
          <LoadingSkeleton rows={3} />
        </div>
      ) : list.isError ? (
        <ErrorState
          title={t('emailPanel.loadError', 'Could not load email')}
          action={
            <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>
              {t('emailPanel.retry', 'Retry')}
            </Button>
          }
        />
      ) : threads.length === 0 ? (
        <EmptyState title={t('emailPanel.empty', 'No email yet')} />
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {threads.map((m) => {
            const Direction = m.isOutbound ? ArrowUpRight : ArrowDownLeft;
            const when = m.sentAt ?? m.receivedAt ?? m.createdAt;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setOpen(m)}
                  className="flex min-h-11 w-full items-center gap-3 px-5 py-3 text-left hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                >
                  <Direction size={14} aria-hidden className="shrink-0 text-[var(--fg-tertiary)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--fg-primary)]" title={m.subject}>
                      {m.subject || t('emailPanel.noSubject', '(no subject)')}
                    </span>
                    <span className="block truncate text-xs text-[var(--fg-tertiary)]" title={m.fromEmail}>
                      {m.fromEmail}
                    </span>
                  </span>
                  <time className="shrink-0 text-xs text-[var(--fg-tertiary)]" dateTime={when}>
                    {formatDate(when)}
                  </time>
                </button>
              </li>
            );
          })}
          {list.hasNextPage ? (
            <li className="flex flex-col items-center gap-2 px-5 py-3">
              {list.isFetchNextPageError ? (
                <p role="alert" className="text-sm text-[var(--danger)]">
                  {t('emailPanel.loadMoreError', 'Could not load older email. Try again.')}
                </p>
              ) : null}
              <Button
                size="sm"
                variant="secondary"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage
                  ? t('emailPanel.loadingMore', 'Loading…')
                  : t('emailPanel.loadMore', 'Load older email')}
              </Button>
            </li>
          ) : null}
        </ul>
      )}

      {open ? (
        <Sheet open onOpenChange={(o) => (o ? undefined : setOpen(null))}>
          <SheetContent
            size="lg"
            title={
              <span className="block truncate" title={open.subject}>
                {open.subject || t('emailPanel.noSubject', '(no subject)')}
              </span>
            }
          >
            {open.threadId ? (
              <EmailThreadView threadId={open.threadId} />
            ) : (
              <p className="whitespace-pre-wrap text-sm text-[var(--fg-primary)]">{open.bodyText}</p>
            )}
          </SheetContent>
        </Sheet>
      ) : null}

      {composing ? (
        <DraftComposer defaultTo={defaultTo} link={filter} onClose={() => setComposing(false)} />
      ) : null}
    </Card>
  );
}
