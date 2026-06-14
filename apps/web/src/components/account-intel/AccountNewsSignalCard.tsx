// Free company news / intent signal on the account view. Source-tagged as
// EXTERNAL / open-web so it's never confused with internal Mantu project facts
// (the demo's "le vrai du faux" rule). Keyless — Google News RSS via the API.

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useAccountNews } from '@/hooks/useAccountNews';

function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

export function AccountNewsSignalCard({ accountId }: { accountId: string }) {
  const news = useAccountNews(accountId);
  const items = news.data?.items ?? [];

  return (
    <Card>
      <SectionHeader
        title="News & signals"
        caption="Recent public-web news about this account — a free activity signal, not internal project data."
        action={<Badge tone="amber">Free · Open web</Badge>}
      />
      <div className="p-5">
        {news.isLoading ? (
          <LoadingSkeleton rows={4} />
        ) : news.isError ? (
          <ErrorState
            title="Could not load news"
            message="The open-web news feed didn't respond. This is a best-effort free signal."
            action={
              <Button size="sm" variant="secondary" onClick={() => void news.refetch()}>
                Retry
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="No recent news"
            message="No public-web headlines matched this account name in the last while."
          />
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2 text-xs text-[var(--fg-secondary)]">
              <Badge tone="gray">External</Badge>
              <span>Source: Google News · verify before treating as a Mantu fact.</span>
            </div>
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.url}
                  className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3"
                >
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-[var(--fg-primary)] hover:text-[var(--brand-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] rounded-sm"
                  >
                    {item.title}
                  </a>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-[var(--fg-tertiary)]">
                    {item.source ? <span>{item.source}</span> : null}
                    {item.source && item.publishedAt ? <span aria-hidden>·</span> : null}
                    {item.publishedAt ? <span>{when(item.publishedAt)}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}
