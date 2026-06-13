/**
 * InfoSearch call lists / lead intel for the open account (A6).
 * Shows live data when INFOSEARCH_ENABLED is configured; otherwise the API
 * returns clearly-labelled sample data so the section is never empty.
 */
import { useQuery } from '@tanstack/react-query';

import { Card, SectionHeader } from '@/components/ui/Card';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { api } from '@/lib/api';

interface InfoSearchLead {
  id: string;
  name: string;
  company: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
  listName: string | null;
}

interface InfoSearchLeadsResponse {
  enabled: boolean;
  preview: boolean;
  items: InfoSearchLead[];
}

export function InfoSearchLeadsCard({ account }: { account: string }) {
  // Always fetch: when InfoSearch is configured we show live leads; when not,
  // the API returns clearly-labelled sample data (preview) so the team sees
  // the populated section rather than nothing.
  const leads = useQuery({
    queryKey: ['infosearch-leads', account],
    queryFn: ({ signal }) =>
      api<InfoSearchLeadsResponse>(
        `/api/infosearch/leads?account=${encodeURIComponent(account)}`,
        { signal },
      ),
    enabled: account.length > 0,
    staleTime: 2 * 60 * 1000,
  });

  const preview = leads.data?.preview ?? false;

  return (
    <Card role="region" aria-label="InfoSearch lead intel">
      <SectionHeader
        title="InfoSearch leads"
        caption={
          preview
            ? 'Sample lead intel — connect InfoSearch (INFOSEARCH_ENABLED) for live call lists'
            : 'Call lists and lead intel for this account — pulled live from InfoSearch'
        }
      />
      <div className="px-5 pb-5">
        {leads.isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : leads.isError ? (
          <ErrorState
            title="InfoSearch is unreachable"
            message={leads.error?.message ?? 'Lead intel could not be loaded.'}
          />
        ) : (leads.data?.items.length ?? 0) === 0 ? (
          <p className="text-sm text-[var(--fg-tertiary)]">
            No InfoSearch leads matched this account.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {leads.data!.items.map((lead) => (
              <li key={lead.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[var(--fg-primary)]">
                    {lead.name}
                    {lead.title ? (
                      <span className="ml-1.5 text-xs font-normal text-[var(--fg-tertiary)]">
                        {lead.title}
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate text-xs text-[var(--fg-tertiary)]">
                    {[lead.company, lead.listName].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2 text-xs">
                  {lead.email ? (
                    <a
                      className="flex min-h-[44px] items-center text-[var(--brand-primary)] hover:underline"
                      href={`mailto:${lead.email}`}
                    >
                      Email
                    </a>
                  ) : null}
                  {lead.phone ? (
                    <a
                      className="flex min-h-[44px] items-center text-[var(--brand-primary)] hover:underline"
                      href={`tel:${lead.phone}`}
                    >
                      Call
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
