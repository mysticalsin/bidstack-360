import { Link } from 'react-router-dom';

import { Card } from '@/components/ui/Card';
import { Badge, stageTone } from '@/components/ui/Badge';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { CreateOpportunityDialog } from '@/components/opportunity/CreateOpportunityDialog';
import { useOpportunities } from '@/hooks/useOpportunities';
import { formatDate, formatMoney, formatStage } from '@/lib/format';

export function OpportunitiesPage() {
  const { data, isLoading, isError, error } = useOpportunities({ limit: 100 });

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
            Opportunities
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            {data?.items.length ?? 0} bids in flight.
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
            <thead className="bg-[var(--surface-sunken)] text-xs text-[var(--fg-tertiary)] uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3 font-semibold">Code</th>
                <th className="px-5 py-3 font-semibold">Opportunity</th>
                <th className="px-5 py-3 font-semibold">Stage</th>
                <th className="px-5 py-3 font-semibold text-right">Value</th>
                <th className="px-5 py-3 font-semibold text-right">Probability</th>
                <th className="px-5 py-3 font-semibold">Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {data?.items.map((o) => (
                <tr
                  key={o.id}
                  className="hover:bg-[var(--surface-sunken)] transition-colors"
                >
                  <td className="px-5 py-3 font-mono text-xs text-[var(--fg-tertiary)]">
                    <Link to={`/opportunities/${o.id}`} className="hover:text-[var(--brand-primary)]">
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
                  <td className="px-5 py-3 text-[var(--fg-secondary)]">
                    {formatDate(o.dueDate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
