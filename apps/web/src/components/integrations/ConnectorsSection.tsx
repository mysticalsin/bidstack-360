// Integrations → Connectors catalog. Surfaces every external data source the
// CRM can reach (SAM.gov, SEAO, Apollo, Clearbit, …), grouped by category,
// with status + credential requirement so an admin can see at a glance which
// open feeds are live and which licensed connectors need wiring.

import { useMemo, useState } from 'react';

import { Card, SectionHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { LoadingSkeleton, ErrorState, EmptyState } from '@/components/ui/StateMessages';
import { useConnectorCatalog } from '@/hooks/useCrmIntegrations';
import { relativeTime } from '@/lib/format';
import type { CrmConnector } from '@bidstack/shared';

type Category = CrmConnector['category'];

const CATEGORY_LABEL: Record<Category, string> = {
  company: 'Company data',
  market: 'Market & open data',
  procurement: 'Procurement & tenders',
  logo: 'Logos & branding',
  people: 'People & contacts',
  ai: 'AI & agents',
};

const ALL: Category[] = ['company', 'market', 'procurement', 'logo', 'people', 'ai'];

export function ConnectorsSection() {
  const { data, isLoading, isError, error, refetch } = useConnectorCatalog();
  const [filter, setFilter] = useState<Category | 'all'>('all');

  // Reference `data?.items` directly in useMemo deps so React's hook linter
  // can verify stability — wrapping `items` in its own useMemo first would
  // be equivalent but adds a redundant memo layer.
  const filtered = useMemo(() => {
    const items = data?.items ?? [];
    return filter === 'all' ? items : items.filter((c) => c.category === filter);
  }, [data?.items, filter]);

  // Counts feed the chip badges so the user can see how many connectors live
  // in each category without clicking through.
  const counts = useMemo(() => {
    const acc: Record<Category, number> = {
      company: 0,
      market: 0,
      procurement: 0,
      logo: 0,
      people: 0,
      ai: 0,
    };
    for (const c of data?.items ?? []) acc[c.category]++;
    return acc;
  }, [data?.items]);

  const items = data?.items ?? [];

  return (
    <Card>
      <SectionHeader
        title="Connectors catalog"
        caption="External data sources the CRM can reach. Open feeds run without keys; licensed feeds need credentials."
      />
      {isLoading ? (
        <LoadingSkeleton rows={4} />
      ) : isError ? (
        <ErrorState
          title="Could not load connectors"
          message={error instanceof Error ? error.message : undefined}
          action={
            <button
              type="button"
              className="text-xs text-[var(--brand-primary)] underline"
              onClick={() => refetch()}
            >
              Try again
            </button>
          }
        />
      ) : (
        <>
          <div
            role="group"
            aria-label="Filter connectors by category"
            className="flex flex-wrap gap-2 px-5 pt-4 text-xs"
          >
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
              All
              <span className="ml-1.5 text-[var(--fg-tertiary)]">{items.length}</span>
            </FilterChip>
            {ALL.map((cat) => (
              <FilterChip key={cat} active={filter === cat} onClick={() => setFilter(cat)}>
                {CATEGORY_LABEL[cat]}
                <span className="ml-1.5 text-[var(--fg-tertiary)]">{counts[cat]}</span>
              </FilterChip>
            ))}
          </div>
          {filtered.length === 0 ? (
            <EmptyState title="No connectors in this category" />
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {filtered.map((c) => (
                <ConnectorRow key={c.id} connector={c} />
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function ConnectorRow({ connector }: { connector: CrmConnector }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <a
            href={connector.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sm font-medium text-[var(--fg-primary)] hover:text-[var(--brand-primary)]"
          >
            {connector.name}
          </a>
          <Badge tone="gray">{CATEGORY_LABEL[connector.category]}</Badge>
          <Badge tone={connector.kind === 'open_api' ? 'jade' : 'amber'}>
            {connector.kind.replace('_', ' ')}
          </Badge>
        </div>
        {connector.message ? (
          <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">{connector.message}</p>
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--fg-tertiary)]">
          <span>Checked {relativeTime(connector.lastCheckedAt)}</span>
          {connector.capabilities.length ? (
            <>
              <span aria-hidden>·</span>
              <span>{connector.capabilities.slice(0, 3).join(' · ')}</span>
            </>
          ) : null}
          <a
            href={connector.docsUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-1.5 text-[var(--brand-primary)] hover:underline"
          >
            Docs ↗
          </a>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {connector.requiresCredential ? (
          <Badge tone="amber">requires key</Badge>
        ) : (
          <Badge tone="blue">open</Badge>
        )}
        <StatusBadge status={connector.status} />
      </div>
    </li>
  );
}

function StatusBadge({ status }: { status: CrmConnector['status'] }) {
  const tone =
    status === 'healthy'
      ? 'jade'
      : status === 'degraded'
        ? 'amber'
        : status === 'down'
          ? 'tomato'
          : 'gray';
  return <Badge tone={tone}>{status}</Badge>;
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 transition-colors ${
        active
          ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]'
          : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--fg-secondary)] hover:border-[var(--border-strong)]'
      }`}
    >
      {children}
    </button>
  );
}
