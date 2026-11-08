// People tab on the company page. The detail payload caps opportunities at
// RELATED_CAP, so when the cap is hit the deal selectors walk every page of
// the company's opportunities instead of offering only the newest ones.
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { AccountPeopleSection } from '@/components/people/AccountPeopleSection';
import { Button } from '@/components/ui/Button';
import { fetchAllCursorPages } from '@/hooks/useInsightsData';

import { RELATED_CAP } from './relatedCount';

type DealOption = { id: string; name: string };

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
  const source = capped && all.data ? all.data.items : opportunities;
  const deals = source.map((o) => ({ id: o.id, name: o.name }));

  return (
    <div className="space-y-3">
      {capped && all.isError ? (
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
      ) : null}
      <AccountPeopleSection companyId={companyId} deals={deals} />
    </div>
  );
}
