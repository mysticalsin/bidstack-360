import { Link, useSearchParams } from 'react-router-dom';

import { Card } from '@/components/ui/Card';
import { Badge, stageTone } from '@/components/ui/Badge';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { CreateOpportunityDialog } from '@/components/opportunity/CreateOpportunityDialog';
import { useOpportunities } from '@/hooks/useOpportunities';
import { formatDate, formatMoney, formatStage } from '@/lib/format';

export function OpportunitiesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('search') ?? undefined;

  const { data, isLoading, isError, error } = useOpportunities({
    limit: 100,
    ...(search ? { search } : {}),
  });

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
            Opportunities
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            {search ? (
              <>
                <span className="font-medium text-[var(--fg-primary)]">
                  {data?.items.length ?? 0}
                </span>{' '}
                results for{' '}
                <span className="rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 font-mono text-xs">
                  &ldquo;{search}&rdquo;
                </span>{' '}
                <button
                  type="button"
                  onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.delete('search');
                    setSearchParams(next);
                  }}
                  className="ml-2 text-xs text-[var(--fg-tertiary)] underline hover:text-[var(--brand-primary)]"
                >
                  clear
                </button>
              </>
            ) : (
              <>{data?.items.length ?? 0} bids in flight.</>
            )}
          </p>
        </div>
        <CreateOpportunityDialog />
      </header>

      <Card className="overflow-hidden">
        {isLoading ? (
          <LoadingSkeleton rows={8} />
        ) : isError ? (
          <ErrorState
            title="Couldn't load opportunities"
            message={error?.message ?? 'Try again in a moment.'}
          />
        ) : data?.items.length === 0 ? (
          <EmptyState
            title="No opportunities yet"
            message="Create your first opportunity to start tracking bids."
          />
        ) : (
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              {search
                ? `Opportunities matching "${search}"`
                : 'All opportunities, sorted by most recent activity'}
            </caption>
            <thead className="bg-[var(--surface-sunken)] text-xs text-[var(--fg-tertiary)] uppercase tracking-wider">
              <tr>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Code
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Opportunity
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Stage
                </th>
                <th scope="col" className="px-5 py-3 font-semibold text-right">
                  Value
                </th>
                <th scope="col" className="px-5 py-3 font-semibold text-right">
                  Probability
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Due
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {data?.items.map((o) => (
                <tr key={o.id} className="hover:bg-[var(--surface-sunken)] transition-colors">
                  <td className="px-5 py-3 font-mono text-xs text-[var(--fg-tertiary)]">
                    <Link
                      to={`/opportunities/${o.id}`}
                      className="hover:text-[var(--brand-primary)]"
                    >
                      {o.code}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <Link
                      to={`/opportunities/${o.id}`}
                      className="font-medium text-[var(--fg-primary)] hover:text-[var(--brand-primary)]"
                    >
                      {o.name}
                    </Link>
                    <div className="text-xs text-[var(--fg-tertiary)]">{o.customer}</div>
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={stageTone(o.stage)}>{formatStage(o.stage)}</Badge>
                  </td>
                  <td className="px-5 py-3 text-right font-semibold text-[var(--fg-primary)] tabular-nums">
                    {formatMoney(o.value, 'EUR')}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-[var(--fg-secondary)]">
                    {o.probability}%
                  </td>
                  <td className="px-5 py-3 text-[var(--fg-secondary)]">{formatDate(o.dueDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
