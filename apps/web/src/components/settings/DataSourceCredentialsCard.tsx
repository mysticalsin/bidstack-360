// Settings → Data sources. The friction-free way to plug in an external data API
// for live enrichment: pick a source, paste the key, hit Test, Save. The key is
// encrypted at rest and never shown again; enrichment uses it automatically.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { confirm } from '@/components/ui/ConfirmDialog';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import {
  useDataProviders,
  useRemoveDataProvider,
  useSaveDataProvider,
  useTestDataProvider,
  type DataProviderSummary,
  type DataProviderTestResult,
} from '@/hooks/useDataProviders';
import { useIsAdmin } from '@/lib/auth';

export function DataSourceCredentialsCard() {
  const { t } = useTranslation('settings');
  const isAdmin = useIsAdmin();
  const providers = useDataProviders();
  const items = providers.data?.items ?? [];

  return (
    <Card>
      <SectionHeader
        title={t('dataSourceCredentials.cardTitle', 'Data sources')}
        caption={t(
          'dataSourceCredentials.cardCaption',
          'Plug in an external data API for live enrichment — paste a key, test it, save. Keys are encrypted at rest and never shown again. Without one, BidStack uses free open data (Wikipedia/Wikidata + news).',
        )}
      />
      <div className="p-5">
        {providers.isLoading ? (
          <LoadingSkeleton rows={2} />
        ) : providers.isError ? (
          <ErrorState
            title={t('dataSourceCredentials.errorTitle', 'Could not load data sources')}
            message={t(
              'dataSourceCredentials.errorMessage',
              'Open data enrichment still works; saved keys could not be loaded.',
            )}
            action={
              <Button size="sm" variant="secondary" onClick={() => void providers.refetch()}>
                {t('dataSourceCredentials.retry', 'Retry')}
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={t('dataSourceCredentials.emptyTitle', 'No data sources')}
            message={t('dataSourceCredentials.emptyMessage', 'The API returns the supported sources.')}
          />
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <DataSourceRow key={item.provider} item={item} isAdmin={isAdmin} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function DataSourceRow({ item, isAdmin }: { item: DataProviderSummary; isAdmin: boolean }) {
  const { t } = useTranslation('settings');
  const save = useSaveDataProvider();
  const remove = useRemoveDataProvider();
  const test = useTestDataProvider();
  const [apiKey, setApiKey] = useState('');
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<DataProviderTestResult | null>(null);

  const onSave = async () => {
    if (!apiKey.trim()) return;
    try {
      await save.mutateAsync({ provider: item.provider, apiKey: apiKey.trim() });
      setApiKey('');
      setEditing(false);
      toast.success(t('dataSourceCredentials.toastConnectedTitle', '{{label}} connected', { label: item.label }), {
        description: t('dataSourceCredentials.toastConnectedDescription', 'Key encrypted. Enrichment will use it.'),
      });
    } catch (err) {
      toast.error(t('dataSourceCredentials.toastSaveErrorTitle', 'Could not save key'), {
        description:
          err instanceof Error
            ? err.message
            : t('dataSourceCredentials.serverRejected', 'The server rejected the request.'),
      });
    }
  };

  const onTest = async () => {
    try {
      const r = await test.mutateAsync(item.provider);
      setResult(r);
      if (r.ok)
        toast.success(t('dataSourceCredentials.toastLiveTitle', '{{label}} is live', { label: item.label }), {
          description: `${r.sample ?? t('dataSourceCredentials.ok', 'ok')} · ${r.latencyMs} ms`,
        });
      else
        toast.error(t('dataSourceCredentials.toastTestFailedTitle', '{{label}} test failed', { label: item.label }), {
          description: r.error ?? t('dataSourceCredentials.noResponse', 'No response.'),
        });
    } catch (err) {
      toast.error(t('dataSourceCredentials.toastTestErrorTitle', 'Test failed'), {
        description:
          err instanceof Error
            ? err.message
            : t('dataSourceCredentials.serverRejected', 'The server rejected the request.'),
      });
    }
  };

  const onRemove = async () => {
    const ok = await confirm({
      title: t('dataSourceCredentials.disconnectConfirmTitle', 'Disconnect {{label}}?', { label: item.label }),
      description: t(
        'dataSourceCredentials.disconnectConfirmDescription',
        'Enrichment falls back to free open data. The stored key is removed.',
      ),
      confirmLabel: t('dataSourceCredentials.disconnectConfirmLabel', 'Disconnect'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(item.provider);
      setResult(null);
      toast.success(t('dataSourceCredentials.toastDisconnectedTitle', '{{label}} disconnected', { label: item.label }));
    } catch (err) {
      toast.error(t('dataSourceCredentials.toastRemoveErrorTitle', 'Remove failed'), {
        description:
          err instanceof Error
            ? err.message
            : t('dataSourceCredentials.serverRejected', 'The server rejected the request.'),
      });
    }
  };

  const showInput = isAdmin && (editing || !item.configured);

  return (
    <li className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{item.label}</h3>
            <Badge tone="gray">{t('dataSourceCredentials.badgeExternal', 'External')}</Badge>
            <Badge tone={item.configured ? 'jade' : 'amber'}>
              {item.configured
                ? t('dataSourceCredentials.badgeConnected', 'Connected')
                : t('dataSourceCredentials.badgeNotConnected', 'Not connected')}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-[var(--fg-secondary)]">{item.description}</p>
          <a
            href={item.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-xs text-[var(--brand-primary)] hover:underline"
          >
            {t('dataSourceCredentials.getApiKey', 'Get an API key →')}
          </a>
        </div>
        {isAdmin && item.configured ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="secondary" onClick={onTest} disabled={test.isPending}>
              {test.isPending
                ? t('dataSourceCredentials.testing', 'Testing…')
                : t('dataSourceCredentials.test', 'Test')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
              {t('dataSourceCredentials.replace', 'Replace')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-[var(--danger)] hover:text-[var(--danger)]"
              onClick={() => void onRemove()}
              disabled={remove.isPending}
            >
              {t('dataSourceCredentials.remove', 'Remove')}
            </Button>
          </div>
        ) : null}
      </div>

      {showInput ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t('dataSourceCredentials.apiKeyPlaceholder', 'Paste your {{label}} API key', {
              label: item.label,
            })}
            className="h-10 min-w-[260px] flex-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
          />
          <Button size="sm" onClick={() => void onSave()} disabled={save.isPending || !apiKey.trim()}>
            {save.isPending
              ? t('dataSourceCredentials.saving', 'Saving…')
              : t('dataSourceCredentials.saveAndEncrypt', 'Save & encrypt')}
          </Button>
          {editing ? (
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setApiKey(''); }}>
              {t('dataSourceCredentials.cancel', 'Cancel')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <p
          role="status"
          className={`mt-2 text-xs ${result.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}
        >
          {result.ok
            ? t('dataSourceCredentials.statusLive', 'Live · {{sample}} · {{latency}} ms', {
                sample: result.sample ?? t('dataSourceCredentials.ok', 'ok'),
                latency: result.latencyMs,
              })
            : t('dataSourceCredentials.statusFailed', 'Failed · {{error}}', {
                error: result.error ?? t('dataSourceCredentials.noResponseShort', 'no response'),
              })}
        </p>
      ) : null}

      {!isAdmin ? (
        <p className="mt-2 text-xs text-[var(--fg-tertiary)]">
          {t('dataSourceCredentials.adminOnly', 'Only admins can manage data-source keys.')}
        </p>
      ) : null}
    </li>
  );
}
