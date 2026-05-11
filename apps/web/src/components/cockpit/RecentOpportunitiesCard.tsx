import { memo } from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, LoadingSkeleton } from '@/components/ui/StateMessages';
import type { useOpportunities } from '@/hooks/useOpportunities';
import { formatMoney, formatStage } from '@/lib/format';

interface Props {
  opps: ReturnType<typeof useOpportunities>;
}

export const RecentOpportunitiesCard = memo(function RecentOpportunitiesCard({ opps }: Props) {
  return (
    <Card>
      <SectionHeader
        title="Recent opportunities"
        caption="Latest activity across all customers"
        action={
          <Link to="/opportunities" className="link-arrow">
            View all <Icon name="arrow" size={12} />
          </Link>
        }
      />
      {opps.isLoading ? (
        <LoadingSkeleton rows={3} />
      ) : opps.data?.items.length === 0 ? (
        <EmptyState title="No opportunities yet" />
      ) : (
        <ul className="proto-list-flat">
          {opps.data?.items.slice(0, 5).map((o) => (
            <li key={o.id} className="proto-row">
              <Link to={`/opportunities/${o.id}`} className="proto-row-link">
                <div className="proto-row-main">
                  <span className="proto-row-code">{o.code}</span>
                  <span className="proto-row-name">{o.name}</span>
                  <span className="proto-row-meta">{o.customer}</span>
                </div>
                <div className="proto-row-right">
                  <span className="proto-row-money">{formatMoney(o.value, 'EUR')}</span>
                  <Badge tone="purple">{formatStage(o.stage)}</Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
});
