// People tab on the company page. The detail payload caps opportunities at
// RELATED_CAP, so when the cap is hit the deal selectors walk every page of
// the company's opportunities. The newest rows are not that catalog until
// the read settles.
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { AccountPeopleSection } from '@/components/people/AccountPeopleSection';
import { Button } from '@/components/ui/Button';
import { fetchAllCursorPages } from '@/hooks/useInsightsData';

import { dealOptionsPhase } from './deal-options-read';
import { RELATED_CAP } from './relatedCount';

type DealOption = { id: string; name: string };

function catalogItems(data: unknown): DealOption[] | null {
  if (!data || typeof data !== 'object' || !('items' in data)) return null;
  const items = (data as { items?: unknown }).items;
  return Array.isArray(items) ? (items as DealOption[]) : null;
}

function asDeals(rows: DealOption[]) {
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

export function CompanyPeopleTab({
  companyId,
  opportunities,
}: {
  companyId: string;
  opportunities: DealOption[];
}) {
  const { t } = useTranslation('crm');
  const capped = opportunities.length >= RELATED_CAP;
  const all = useQuery({
    queryKey: ['company-deal-options', companyId],
    queryFn: ({ signal }) => fetchAllCursorPages<DealOption>('/api/opportunities', signal, { companyId }),
    enabled: capped,
    staleTime: 60_000,
  });

  if (!capped) {
    return (
      <div className="space-y-3">
        <AccountPeopleSection companyId={companyId} deals={asDeals(opportunities)} />
      </div>
    );
  }

  const phase = dealOptionsPhase({
    data: all.data,
    isError: all.isError,
    status: all.status,
  });
  if (phase === 'unread') {
    return (
      <p role="status">
        {t('companyDetail.dealOptionsChecking', 'Checking every deal. The full list has not arrived.')}
      </p>
    );
  }
  if (phase === 'failed') {
    return (
      <div className="space-y-3">
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-[var(--danger)]">
          <span>
            {t('companyDetail.dealOptionsError', 'Could not load every deal. Only the {{count}} most recent are listed.', {
              count: RELATED_CAP,
            })}
          </span>
          <Button size="sm" variant="secondary" onClick={() => void all.refetch()}>
            {t('companyDetail.retry', 'Retry')}
          </Button>
        </div>
        <AccountPeopleSection companyId={companyId} deals={asDeals(opportunities)} />
      </div>
    );
  }

  const items = catalogItems(all.data);
  return (
    <div className="space-y-3">
      <AccountPeopleSection companyId={companyId} deals={asDeals(items ?? opportunities)} />
    </div>
  );
}
