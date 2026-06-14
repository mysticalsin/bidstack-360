// Integrations → Connectors catalog. Surfaces every external data source the
// CRM can reach (SAM.gov, SEAO, Apollo, Clearbit, …), grouped by category,
// with status + credential requirement so an admin can see at a glance which
// open feeds are live and which licensed connectors need wiring.

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Card, SectionHeader } from '@/components/ui/Card';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Icon, type IconName } from '@/components/ui/Icon';
import { LoadingSkeleton, ErrorState, EmptyState } from '@/components/ui/StateMessages';
import { useConnectorCatalog, useUserIntegrationsStatus } from '@/hooks/useCrmIntegrations';
import { relativeTime } from '@/lib/format';
import { api } from '@/lib/api';
import { LiquidGlassButton } from '@/components/ui/LiquidGlassButton';
import type { CrmConnector } from '@bidstack/shared';

type Category = CrmConnector['category'];

type TFunc = ReturnType<typeof useTranslation>['t'];

function categoryLabel(t: TFunc, category: Category): string {
  switch (category) {
    case 'company':
      return t('connectors.category.company', 'Company data');
    case 'market':
      return t('connectors.category.market', 'Market & open data');
    case 'procurement':
      return t('connectors.category.procurement', 'Procurement & tenders');
    case 'logo':
      return t('connectors.category.logo', 'Logos & branding');
    case 'people':
      return t('connectors.category.people', 'People & contacts');
    case 'ai':
      return t('connectors.category.ai', 'AI & agents');
  }
}

const ALL: Category[] = ['company', 'market', 'procurement', 'logo', 'people', 'ai'];

export function ConnectorsSection() {
  const { t } = useTranslation('integrations');
  const { data, isLoading, isError, error, refetch } = useConnectorCatalog();
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const items = useMemo(() => data?.items ?? [], [data?.items]);

  // can verify stability — wrapping `items` in its own useMemo first would
  const filtered = useMemo(() => {
    return filter === 'all' ? items : items.filter((c) => c.category === filter);
  }, [filter, items]);

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

  const statusCounts = useMemo(() => {
    const acc: Record<CrmConnector['status'], number> = {
      healthy: 0,
      degraded: 0,
      down: 0,
      disabled: 0,
    };
    for (const connector of items) acc[connector.status]++;
    return acc;
  }, [items]);
  const credentialCount = items.filter((connector) => connector.requiresCredential).length;

  return (
    <Card className="overflow-hidden border-[var(--border-subtle)] bg-[var(--surface-primary)]">
      <SectionHeader
        title={t('connectors.header.title', 'Connectors catalog')}
        caption={t(
          'connectors.header.caption',
          'External data sources BidStack can reach. Open feeds run without keys; licensed feeds need credentials.',
        )}
        action={
          <Badge
            tone={statusCounts.down > 0 ? 'tomato' : statusCounts.degraded > 0 ? 'amber' : 'jade'}
          >
            {t('connectors.header.sourcesBadge', '{{count}} sources', { count: items.length })}
          </Badge>
        }
      />
      {isLoading ? (
        <div className="p-5">
          <LoadingSkeleton rows={4} />
        </div>
      ) : isError ? (
        <ErrorState
          title={t('connectors.error.title', 'Could not load connectors')}
          message={error instanceof Error ? error.message : undefined}
          action={
            <button
              type="button"
              className="text-xs text-[var(--brand-primary)] underline"
              onClick={() => refetch()}
            >
              {t('connectors.error.retry', 'Try again')}
            </button>
          }
        />
      ) : (
        <>
          <div className="grid gap-3 p-5 md:grid-cols-4">
            <ConnectorStat
              icon="globe"
              label={t('connectors.stat.totalSources', 'Total sources')}
              value={String(items.length)}
              tone="blue"
            />
            <ConnectorStat
              icon="checkCircle"
              label={t('connectors.stat.healthy', 'Healthy')}
              value={String(statusCounts.healthy)}
              tone="jade"
            />
            <ConnectorStat
              icon="shield"
              label={t('connectors.stat.needsKey', 'Needs key')}
              value={String(credentialCount)}
              tone={credentialCount > 0 ? 'amber' : 'gray'}
            />
            <ConnectorStat
              icon="warning"
              label={t('connectors.stat.degradedDown', 'Degraded/down')}
              value={String(statusCounts.degraded + statusCounts.down)}
              tone={statusCounts.down > 0 ? 'tomato' : statusCounts.degraded > 0 ? 'amber' : 'gray'}
            />
          </div>
          <div
            role="group"
            aria-label={t('connectors.filter.groupLabel', 'Filter connectors by category')}
            className="flex flex-wrap gap-2 border-t border-[var(--border-subtle)] px-5 py-4 text-xs"
          >
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
              {t('connectors.filter.all', 'All')}
              <span className="ml-1.5 text-[var(--fg-tertiary)]">{items.length}</span>
            </FilterChip>
            {ALL.map((cat) => (
              <FilterChip key={cat} active={filter === cat} onClick={() => setFilter(cat)}>
                {categoryLabel(t, cat)}
                <span className="ml-1.5 text-[var(--fg-tertiary)]">{counts[cat]}</span>
              </FilterChip>
            ))}
          </div>
          {filtered.length === 0 ? (
            <EmptyState title={t('connectors.empty.title', 'No connectors in this category')} />
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

function ConnectorStat({
  icon,
  label,
  value,
  tone,
}: {
  icon: IconName;
  label: string;
  value: string;
  tone: BadgeTone;
}) {
  const { t } = useTranslation('integrations');
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
          {label}
        </span>
        <span className="grid size-8 place-items-center rounded-xl bg-[var(--surface-primary)] text-[var(--text-secondary)]">
          <Icon name={icon} className="size-4" />
        </span>
      </div>
      <div className="mt-4 text-xl font-semibold tabular-nums text-[var(--text-primary)]">
        {value}
      </div>
      <Badge tone={tone} className="mt-2">
        {t('connectors.stat.catalogBadge', 'catalog')}
      </Badge>
    </div>
  );
}

function ConnectorRow({ connector }: { connector: CrmConnector }) {
  const { t } = useTranslation('integrations');
  const qc = useQueryClient();
  const { data: userIntegrationsData } = useUserIntegrationsStatus();

  // Connect mutation
  const connectMutation = useMutation({
    mutationFn: async () => {
      let startUrl = '';
      if (connector.id === 'gmail') {
        startUrl = '/api/integrations/gmail/oauth/start';
      } else if (connector.id === 'slack') {
        startUrl = '/api/integrations/slack/oauth/start';
      } else if (connector.id === 'microsoft') {
        startUrl = '/api/integrations/microsoft/mail/oauth/start';
      }
      if (!startUrl) return;
      const res = await api<{ authUrl: string }>(startUrl);
      if (res.authUrl) {
        window.location.href = res.authUrl;
      }
    },
  });

  // Disconnect mutation
  const disconnectMutation = useMutation({
    mutationFn: async () => {
      let disconnectUrl = '';
      if (connector.id === 'gmail') {
        disconnectUrl = '/api/integrations/gmail/disconnect';
      } else if (connector.id === 'slack') {
        disconnectUrl = '/api/integrations/slack/disconnect';
      } else if (connector.id === 'microsoft') {
        disconnectUrl = '/api/integrations/microsoft/mail/disconnect';
      }
      if (!disconnectUrl) return;
      await api(disconnectUrl, { method: 'DELETE' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-integrations-status'] });
      qc.invalidateQueries({ queryKey: ['crm-connectors'] });
      qc.invalidateQueries({ queryKey: ['crm-provider-health'] });
    },
  });

  const isUserIntegration = ['gmail', 'slack', 'microsoft'].includes(connector.id);
  const match = isUserIntegration
    ? userIntegrationsData?.integrations?.find((ui) => {
        if (connector.id === 'gmail') return ui.provider === 'gmail';
        if (connector.id === 'slack') return ui.provider === 'slack';
        if (connector.id === 'microsoft') return ui.provider === 'microsoft_graph';
        return false;
      })
    : null;

  const isConnected = match ? match.status === 'CONNECTED' : false;
  const status = match
    ? match.status === 'CONNECTED'
      ? 'healthy'
      : match.status === 'ERROR'
        ? 'down'
        : 'disabled'
    : connector.status;

  const connectedEmail = match?.connectedEmail;

  return (
    <li
      data-testid={`integration-card-${connector.id}`}
      className="flex flex-wrap items-start justify-between gap-4 px-5 py-4 transition hover:bg-[var(--surface-secondary)]/70"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid size-9 place-items-center rounded-2xl bg-[var(--surface-secondary)] text-[var(--text-secondary)]">
            <Icon name={connector.category === 'ai' ? 'sparkle' : 'globe'} className="size-4" />
          </span>
          <a
            href={connector.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sm font-medium text-[var(--fg-primary)] hover:text-[var(--brand-primary)]"
          >
            {connector.name}
          </a>
          <Badge tone="gray">{categoryLabel(t, connector.category)}</Badge>
          <Badge tone={connector.kind === 'open_api' ? 'jade' : 'amber'}>
            {connector.kind.replace('_', ' ')}
          </Badge>
        </div>
        {connector.message ? (
          <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">{connector.message}</p>
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--fg-tertiary)]">
          <span>
            {t('connectors.row.checkedAt', 'Checked {{time}}', {
              time: relativeTime(connector.lastCheckedAt),
            })}
          </span>
          {connector.capabilities.length ? (
            <>
              <span aria-hidden>.</span>
              <span>{connector.capabilities.slice(0, 3).join(' / ')}</span>
            </>
          ) : null}
          <a
            href={connector.docsUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-1.5 text-[var(--brand-primary)] hover:underline"
          >
            {t('connectors.row.docsLink', 'Docs ↗')}
          </a>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {isUserIntegration ? (
          <>
            {connectedEmail ? <Badge tone="jade">{connectedEmail}</Badge> : null}
            {isConnected ? (
              <LiquidGlassButton
                tone="danger"
                size="sm"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                {disconnectMutation.isPending
                  ? t('connectors.row.disconnecting', 'Disconnecting...')
                  : t('connectors.row.disconnect', 'Disconnect')}
              </LiquidGlassButton>
            ) : (
              <LiquidGlassButton
                tone="primary"
                size="sm"
                onClick={() => connectMutation.mutate()}
                disabled={connectMutation.isPending}
              >
                {connectMutation.isPending
                  ? t('connectors.row.connecting', 'Connecting...')
                  : t('connectors.row.connect', 'Connect')}
              </LiquidGlassButton>
            )}
          </>
        ) : connector.requiresCredential ? (
          <Badge tone="amber">{t('connectors.row.requiresKey', 'requires key')}</Badge>
        ) : (
          <Badge tone="blue">{t('connectors.row.open', 'open')}</Badge>
        )}
        <StatusBadge status={status} />
      </div>
    </li>
  );
}

function StatusBadge({ status }: { status: CrmConnector['status'] }) {
  const { t } = useTranslation('integrations');
  const tone =
    status === 'healthy'
      ? 'jade'
      : status === 'degraded'
        ? 'amber'
        : status === 'down'
          ? 'tomato'
          : 'gray';
  const label =
    status === 'healthy'
      ? t('connectors.status.healthy', 'healthy')
      : status === 'degraded'
        ? t('connectors.status.degraded', 'degraded')
        : status === 'down'
          ? t('connectors.status.down', 'down')
          : t('connectors.status.disabled', 'disabled');
  return <Badge tone={tone}>{label}</Badge>;
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
      className={`min-h-10 rounded-2xl border px-3 py-2 text-left transition-colors focus:outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/15 ${
        active
          ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]'
          : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--fg-secondary)] hover:border-[var(--border-strong)]'
      }`}
    >
      {children}
    </button>
  );
}
