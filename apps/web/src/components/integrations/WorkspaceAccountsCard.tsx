// Google Workspace and Microsoft 365: one card per provider for the signed-in
// user's own mailbox and calendar. Read-only grants; Polo files what it reads.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { confirm } from '@/components/ui/ConfirmDialog';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';

/** Pinned in tests: the consent promise shown above both accounts. */
export const WORKSPACE_CONSENT_COPY = 'Read-only. Polo never sends mail or changes your calendar.';

type Provider = 'google' | 'microsoft';
type Status = 'connected' | 'disconnected' | 'error' | 'revoked';

interface WorkspaceCard {
  provider: Provider;
  configured: boolean;
  status: Status;
  accountEmail: string | null;
  scopes: Array<{ key: string; label: string; access: 'read' | 'write' }>;
  lastSyncedAt: string | null;
  connectedAt: string | null;
  errorMessage: string | null;
}

const QUERY_KEY = ['workspace-accounts'];

// Test ids match the legacy catalog rows so existing flows keep their anchors.
const TEST_ID: Record<Provider, string> = { google: 'gmail', microsoft: 'microsoft' };

const STATUS_TONE: Record<Status, BadgeTone> = {
  connected: 'jade',
  disconnected: 'gray',
  error: 'amber',
  revoked: 'tomato',
};

export function WorkspaceAccountsCard() {
  const { t } = useTranslation('integrations');
  const query = useQuery<{ providers: WorkspaceCard[] }>({
    queryKey: QUERY_KEY,
    queryFn: () => api('/api/integrations/workspace'),
    staleTime: 30_000,
  });

  return (
    <Card data-testid="workspace-accounts">
      <SectionHeader
        title={t('workspace.title', 'Email and calendar')}
        caption={t('workspace.consent', WORKSPACE_CONSENT_COPY)}
      />
      {query.isLoading ? (
        <div className="p-5">
          <LoadingSkeleton rows={2} />
        </div>
      ) : query.isError ? (
        <ErrorState
          title={t('workspace.loadError', 'Could not load accounts')}
          action={
            <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
              {t('workspace.retry', 'Retry')}
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {(query.data?.providers ?? []).map((card) => (
            <AccountRow key={card.provider} card={card} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function AccountRow({ card }: { card: WorkspaceCard }) {
  const { t } = useTranslation('integrations');
  const qc = useQueryClient();
  const name =
    card.provider === 'google'
      ? t('workspace.google', 'Google Workspace')
      : t('workspace.microsoft', 'Microsoft 365');
  const statusLabel: Record<Status, string> = {
    connected: t('workspace.statusConnected', 'Connected'),
    disconnected: card.configured
      ? t('workspace.statusDisconnected', 'Not connected')
      : t('workspace.statusNotConfigured', 'Not set up'),
    error: t('workspace.statusError', 'Sync error'),
    revoked: t('workspace.statusRevoked', 'Access revoked'),
  };

  const connect = useMutation({
    mutationFn: () =>
      api<{ authUrl: string }>(`/api/integrations/workspace/${card.provider}/connect`, { method: 'POST' }),
    onSuccess: (res) => {
      if (res?.authUrl) window.location.assign(res.authUrl);
    },
  });
  const disconnect = useMutation({
    mutationFn: () => api(`/api/integrations/workspace/${card.provider}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  async function onDisconnect() {
    const ok = await confirm({
      title: t('workspace.disconnectTitle', 'Disconnect {{name}}?', { name }),
      description: t(
        'workspace.disconnectBody',
        'Polo stops syncing and forgets the access grant. Filed emails and meetings stay.',
      ),
      confirmLabel: t('workspace.disconnect', 'Disconnect'),
      destructive: true,
    });
    if (ok) disconnect.mutate();
  }

  const linked = card.status !== 'disconnected';

  return (
    <li
      className="flex flex-wrap items-start gap-4 px-5 py-4"
      data-testid={`integration-card-${TEST_ID[card.provider]}`}
    >
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-sunken)] text-[var(--fg-secondary)]"
      >
        <Mail size={18} />
      </span>
      <div className="min-w-0 flex-1 basis-56 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{name}</h3>
          <Badge tone={STATUS_TONE[card.status]}>{statusLabel[card.status]}</Badge>
        </div>
        {card.accountEmail ? (
          <p className="truncate text-sm text-[var(--fg-secondary)]" title={card.accountEmail}>
            {card.accountEmail}
          </p>
        ) : null}
        {card.errorMessage ? (
          <p className="text-sm text-[var(--danger)]" role="status">
            {card.errorMessage}
          </p>
        ) : null}
        {connect.isError ? (
          <p className="text-sm text-[var(--danger)]" role="alert">
            {t('workspace.connectError', 'Could not start the connection. Try again.')}
          </p>
        ) : null}
        {disconnect.isError ? (
          <p className="text-sm text-[var(--danger)]" role="alert">
            {t('workspace.disconnectError', 'Could not disconnect. Access is still active. Try again.')}
          </p>
        ) : null}
        {card.scopes.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label={t('workspace.scopes', 'Access')}>
            {card.scopes.map((s) => (
              <li key={s.key}>
                <Badge tone={s.access === 'write' ? 'amber' : 'gray'}>{s.label}</Badge>
              </li>
            ))}
          </ul>
        ) : null}
        {linked ? (
          <p className="text-xs text-[var(--fg-tertiary)]">
            {card.lastSyncedAt
              ? t('workspace.lastSync', 'Last sync {{when}}', { when: relativeTime(card.lastSyncedAt) })
              : t('workspace.neverSynced', 'Not synced yet')}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {linked ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={connect.isPending || !card.configured}
              onClick={() => connect.mutate()}
            >
              {t('workspace.reconnect', 'Reconnect')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={disconnect.isPending}
              onClick={() => void onDisconnect()}
            >
              {t('workspace.disconnect', 'Disconnect')}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            disabled={connect.isPending || !card.configured}
            title={card.configured ? undefined : t('workspace.notConfiguredHint', 'An admin must add the OAuth app first.')}
            onClick={() => connect.mutate()}
          >
            {t('workspace.connect', 'Connect')}
          </Button>
        )}
      </div>
    </li>
  );
}
