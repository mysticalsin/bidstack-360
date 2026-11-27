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
import { useHasPermission } from '@/hooks/useCapabilities';
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

const WORKSPACE_CONNECTOR_IDS = new Set(['gmail', 'microsoft']);

const ALL: Category[] = ['company', 'market', 'procurement', 'logo', 'people', 'ai'];

export function ConnectorsSection() {
  const { t } = useTranslation('integrations');
  const { data, isLoading, isError, error, refetch } = useConnectorCatalog();
  const userIntegrations = useUserIntegrationsStatus();
  const slackLinked =
    userIntegrations.data?.integrations.some(
      (row) => row.provider === 'slack' && row.status === 'CONNECTED',
    ) ?? false;
  const [filter, setFilter] = useState<Category | 'all'>('all');
  // Gmail and Microsoft 365 live on WorkspaceAccountsCard, one card per provider.
  const items = useMemo(
    () => (data?.items ?? []).filter((c) => !WORKSPACE_CONNECTOR_IDS.has(c.id)),
    [data?.items],
  );

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
      unverified: 0,
      down: 0,
      disabled: 0,
    };
    for (const connector of items) {
      // A server credential makes the Slack catalog row "healthy" before any
      // workspace is linked. That is not a live connection, so it stays out
      // of the healthy total until this org is actually connected.
      const status =
        connector.id === 'slack' && connector.status === 'healthy' && !slackLinked
          ? 'disabled'
          : connector.status;
      acc[status]++;
    }
    return acc;
  }, [items, slackLinked]);
  const credentialCount = items.filter((connector) => connector.requiresCredential).length;

  return (
    <Card className="overflow-hidden border-[var(--border-subtle)] bg-[var(--surface-primary)]">
      <SectionHeader
        title={t('connectors.header.title', 'Connectors catalog')}
        caption={t(
          'connectors.header.caption',
          'External data sources Polo PreSales can reach. Open feeds run without keys; licensed feeds need credentials.',
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
  // Slack disconnect tears down the org's ONE shared workspace connection
  // (server-gated behind integrations:write).
  const canDisconnectSlack = useHasPermission('integrations:write');
  const slackWriteHint = t(
    'connectors.row.slackWriteHint',
    'You need integrations write access to disconnect the shared Slack workspace.',
  );

  const slackAppReady = connector.id !== 'slack' || connector.status !== 'disabled';
  const slackNotSetUpHint = t(
    'connectors.row.slackNotSetUpHint',
    'An admin must add the Slack app first.',
  );
  const slackConnectWriteHint = t(
    'connectors.row.slackConnectWriteHint',
    'You need integrations write access to connect the shared Slack workspace.',
  );

  // Connect mutation. A missing Slack app or a reader must not leave the page,
  // and a start response with no consent URL is a failure, not a success.
  const connectMutation = useMutation({
    mutationFn: async () => {
      if (connector.id !== 'slack' || !slackAppReady || !canDisconnectSlack) return;
      const res = await api<{ authUrl?: string }>('/api/integrations/slack/oauth/start');
      const authUrl = typeof res?.authUrl === 'string' ? res.authUrl.trim() : '';
      if (!authUrl) throw new Error('Slack connect returned no consent URL');
      window.location.assign(authUrl);
    },
  });

  // Disconnect mutation
  const disconnectMutation = useMutation({
    mutationFn: async () => {
      if (connector.id !== 'slack') return;
      await api('/api/integrations/slack/disconnect', { method: 'DELETE' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-integrations-status'] });
      qc.invalidateQueries({ queryKey: ['crm-connectors'] });
      qc.invalidateQueries({ queryKey: ['crm-provider-health'] });
    },
  });

  const isUserIntegration = connector.id === 'slack';
  const match = isUserIntegration
    ? userIntegrationsData?.integrations?.find((ui) => ui.provider === 'slack')
    : null;

  const isConnected = match ? match.status === 'CONNECTED' : false;
  const slackConnectHint = !isUserIntegration || isConnected
    ? undefined
    : !slackAppReady
      ? slackNotSetUpHint
      : !canDisconnectSlack
        ? slackConnectWriteHint
        : undefined;
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
        {isUserIntegration && !isConnected ? (
          <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">
            {match?.status === 'ERROR' && match.errorMessage
              ? match.errorMessage
              : !slackAppReady
                ? slackNotSetUpHint
                : t(
                    'connectors.row.slackNotLinked',
                    'This workspace is not connected. Connect to send alerts.',
                  )}
          </p>
        ) : connector.message ? (
          <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">{connector.message}</p>
        ) : null}
        {connectMutation.isError ? (
          <p className="mt-1 text-xs text-[var(--danger)]" role="alert">
            {t(
              'connectors.row.slackConnectFailed',
              'Could not start the Slack connection. Try again.',
            )}
          </p>
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[var(--fg-tertiary)]">
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
                disabled={
                  disconnectMutation.isPending ||
                  (connector.id === 'slack' && !canDisconnectSlack)
                }
                title={
                  connector.id === 'slack' && !canDisconnectSlack ? slackWriteHint : undefined
                }
                aria-label={
                  connector.id === 'slack' && !canDisconnectSlack
                    ? `${t('connectors.row.disconnect', 'Disconnect')} — ${slackWriteHint}`
                    : undefined
                }
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
                disabled={connectMutation.isPending || Boolean(slackConnectHint)}
                title={slackConnectHint}
                aria-label={
                  slackConnectHint
                    ? `${t('connectors.row.connect', 'Connect')}. ${slackConnectHint}`
                    : undefined
                }
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
        {isUserIntegration && !isConnected && match?.status !== 'ERROR' ? (
          <Badge tone={slackAppReady ? 'gray' : 'amber'}>
            {slackAppReady
              ? t('connectors.row.notConnected', 'Not connected')
              : t('connectors.row.notSetUp', 'Not set up')}
          </Badge>
        ) : (
          <StatusBadge status={status} />
        )}
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
          : status === 'unverified'
            ? 'amber'
            : 'gray';
  const label =
    status === 'healthy'
      ? t('connectors.status.healthy', 'healthy')
      : status === 'degraded'
        ? t('connectors.status.degraded', 'degraded')
        : status === 'down'
          ? t('connectors.status.down', 'down')
          : status === 'unverified'
            ? t('connectors.status.unverified', 'unverified')
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
