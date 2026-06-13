/**
 * InfoSearch call lists / lead intel for the open account (A6).
 * Hidden entirely unless INFOSEARCH_ENABLED is on server-side — the brief
 * forbids empty placeholders for unconfigured integrations.
 */
import { useQuery } from '@tanstack/react-query';

import { Card, SectionHeader } from '@/components/ui/Card';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
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
  items: InfoSearchLead[];
}

export function InfoSearchLeadsCard({ account }: { account: string }) {
  const flags = useFeatureFlags();
  const leads = useQuery({
    queryKey: ['infosearch-leads', account],
    queryFn: ({ signal }) =>
      api<InfoSearchLeadsResponse>(
        `/api/infosearch/leads?account=${encodeURIComponent(account)}`,
        { signal },
      ),
    enabled: flags.infosearchEnabled && account.length > 0,
    staleTime: 2 * 60 * 1000,
  });

  if (!flags.infosearchEnabled) return null;
  if (leads.data && !leads.data.enabled) return null;

  return (
    <Card role="region" aria-label="InfoSearch lead intel">
      <SectionHeader
        title="InfoSearch leads"
        caption="Call lists and lead intel for this account — pulled live from InfoSearch"
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
                      className="flex min-h-[36px] items-center text-[var(--brand-primary)] hover:underline"
                      href={`mailto:${lead.email}`}
                    >
                      Email
                    </a>
                  ) : null}
                  {lead.phone ? (
                    <a
                      className="flex min-h-[36px] items-center text-[var(--brand-primary)] hover:underline"
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
