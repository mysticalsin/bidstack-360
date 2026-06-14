// Settings → Data sources. The friction-free way to plug in an external data API
// for live enrichment: pick a source, paste the key, hit Test, Save. The key is
// encrypted at rest and never shown again; enrichment uses it automatically.

import { useState } from 'react';

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
  const isAdmin = useIsAdmin();
  const providers = useDataProviders();
  const items = providers.data?.items ?? [];

  return (
    <Card>
      <SectionHeader
        title="Data sources"
        caption="Plug in an external data API for live enrichment — paste a key, test it, save. Keys are encrypted at rest and never shown again. Without one, BidStack uses free open data (Wikipedia/Wikidata + news)."
      />
      <div className="p-5">
        {providers.isLoading ? (
          <LoadingSkeleton rows={2} />
        ) : providers.isError ? (
          <ErrorState
            title="Could not load data sources"
            message="Open data enrichment still works; saved keys could not be loaded."
            action={
              <Button size="sm" variant="secondary" onClick={() => void providers.refetch()}>
                Retry
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState title="No data sources" message="The API returns the supported sources." />
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
      toast.success(`${item.label} connected`, { description: 'Key encrypted. Enrichment will use it.' });
    } catch (err) {
      toast.error('Could not save key', {
        description: err instanceof Error ? err.message : 'The server rejected the request.',
      });
    }
  };

  const onTest = async () => {
    try {
      const r = await test.mutateAsync(item.provider);
      setResult(r);
      if (r.ok) toast.success(`${item.label} is live`, { description: `${r.sample ?? 'ok'} · ${r.latencyMs} ms` });
      else toast.error(`${item.label} test failed`, { description: r.error ?? 'No response.' });
    } catch (err) {
      toast.error('Test failed', {
        description: err instanceof Error ? err.message : 'The server rejected the request.',
      });
    }
  };

  const onRemove = async () => {
    const ok = await confirm({
      title: `Disconnect ${item.label}?`,
      description: 'Enrichment falls back to free open data. The stored key is removed.',
      confirmLabel: 'Disconnect',
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(item.provider);
      setResult(null);
      toast.success(`${item.label} disconnected`);
    } catch (err) {
      toast.error('Remove failed', {
        description: err instanceof Error ? err.message : 'The server rejected the request.',
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
            <Badge tone="gray">External</Badge>
            <Badge tone={item.configured ? 'jade' : 'amber'}>
              {item.configured ? 'Connected' : 'Not connected'}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-[var(--fg-secondary)]">{item.description}</p>
          <a
            href={item.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-xs text-[var(--brand-primary)] hover:underline"
          >
            Get an API key →
          </a>
        </div>
        {isAdmin && item.configured ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="secondary" onClick={onTest} disabled={test.isPending}>
              {test.isPending ? 'Testing…' : 'Test'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
              Replace
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-[var(--danger)] hover:text-[var(--danger)]"
              onClick={() => void onRemove()}
              disabled={remove.isPending}
            >
              Remove
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
            placeholder={`Paste your ${item.label} API key`}
            className="h-10 min-w-[260px] flex-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
          />
          <Button size="sm" onClick={() => void onSave()} disabled={save.isPending || !apiKey.trim()}>
            {save.isPending ? 'Saving…' : 'Save & encrypt'}
          </Button>
          {editing ? (
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setApiKey(''); }}>
              Cancel
            </Button>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <p
          role="status"
          className={`mt-2 text-xs ${result.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}
        >
          {result.ok ? `Live · ${result.sample ?? 'ok'} · ${result.latencyMs} ms` : `Failed · ${result.error ?? 'no response'}`}
        </p>
      ) : null}

      {!isAdmin ? (
        <p className="mt-2 text-xs text-[var(--fg-tertiary)]">Only admins can manage data-source keys.</p>
      ) : null}
    </li>
  );
}
