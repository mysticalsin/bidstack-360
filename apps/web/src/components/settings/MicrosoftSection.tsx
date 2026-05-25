// Settings → Microsoft 365 Integration Hub.
// Shows SSO status, Outlook Email connection, and Outlook Calendar connection.
// Each service has its own connection card with status, actions, and health.

import { useState } from 'react';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { useAuth, useUser } from '@/lib/auth';
import { useIsAdmin } from '@/lib/auth';
import {
  useMicrosoftConnection,
  useMicrosoftConnect,
  useMicrosoftDisconnect,
} from '@/hooks/useMicrosoftConnection';

interface ConnectionCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: 'connected' | 'disconnected' | 'error';
  accountInfo?: string;
  lastSync?: string | null;
  errorMessage?: string | null;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onSync?: () => void;
}

export function MicrosoftSection() {
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const isAdmin = useIsAdmin();
  const microsoftEnabled = import.meta.env.VITE_SSO_MICROSOFT_ENABLED === 'true';
  const usingClerk = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

  const connection = useMicrosoftConnection();
  const connect = useMicrosoftConnect();
  const disconnect = useMicrosoftDisconnect();

  const data = connection.data;
  const [notice, setNotice] = useState<string | null>(null);

  const handleConnect = (service: 'email' | 'calendar', label: string) => {
    setNotice(null);
    connect.mutate(
      { service },
      {
        onSuccess: (res) => {
          if (res.authUrl && res.authUrl !== 'PLACEHOLDER') {
            window.location.href = res.authUrl;
            return;
          }

          setNotice(
            `${label} OAuth is not configured yet. Add Microsoft credentials before connecting this workspace.`,
          );
        },
        onError: (mutationError) => {
          setNotice(
            mutationError instanceof Error
              ? mutationError.message
              : `Could not start ${label} connection.`,
          );
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <SectionHeader
          title="Microsoft 365"
          caption="Connect Microsoft 365 for sign-in and optional Outlook sync."
        />
        <div className="p-5 space-y-4">
          {connection.isLoading ? (
            <LoadingSkeleton rows={3} />
          ) : (
            <>
              {/* SSO Card */}
              <ConnectionCard
                icon={<Icon name="shield" size={20} className="text-[var(--brand-primary)]" />}
                title="Single Sign-On"
                description="Sign in to BidStack with your Microsoft work account."
                status={data?.ssoConnected ?? (microsoftEnabled && isSignedIn) ? 'connected' : 'disconnected'}
                accountInfo={data?.ssoEmail ?? user?.primaryEmailAddress?.emailAddress ?? undefined}
                onConnect={undefined}
                onDisconnect={undefined}
              />

              {/* Email Card */}
              <ConnectionCard
                icon={<Icon name="mail" size={20} className="text-[var(--brand-primary)]" />}
                title="Outlook Email"
                description="When connected, add Outlook email activity to contact and opportunity records."
                status={data?.emailError ? 'error' : data?.emailConnected ? 'connected' : 'disconnected'}
                lastSync={data?.emailLastSync}
                errorMessage={data?.emailError}
                onConnect={() => handleConnect('email', 'Outlook Email')}
                onDisconnect={() => disconnect.mutate({ service: 'email' })}
              />

              {/* Calendar Card */}
              <ConnectionCard
                icon={<Icon name="calendar" size={20} className="text-[var(--fg-amber)]" />}
                title="Outlook Calendar"
                description="Create tasks or notes from calendar events when calendar sync is enabled."
                status={data?.calendarError ? 'error' : data?.calendarConnected ? 'connected' : 'disconnected'}
                lastSync={data?.calendarLastSync}
                errorMessage={data?.calendarError}
                onConnect={() => handleConnect('calendar', 'Outlook Calendar')}
                onDisconnect={() => disconnect.mutate({ service: 'calendar' })}
              />
              {notice ? (
                <div
                  role="status"
                  className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-4 py-3 text-sm text-[var(--fg-secondary)]"
                >
                  {notice}
                </div>
              ) : null}
            </>
          )}
        </div>
      </Card>

      {isAdmin && (
        <Card>
          <SectionHeader
            title="Workspace configuration"
            caption="Admin-only Microsoft Entra ID settings."
          />
          <dl className="divide-y divide-[var(--border-subtle)] text-sm">
            <DetailRow label="SSO method">
              <Badge tone={usingClerk ? 'jade' : 'gray'}>
                {usingClerk ? 'Clerk Enterprise' : 'Dev stub'}
              </Badge>
            </DetailRow>
            <DetailRow label="Microsoft OAuth">
              <Badge tone={microsoftEnabled ? 'jade' : 'gray'}>
                {microsoftEnabled ? 'Enabled' : 'Disabled'}
              </Badge>
            </DetailRow>
            <DetailRow label="Allowed domains">
              <span className="text-[var(--fg-secondary)]">
                {import.meta.env.VITE_SSO_ALLOWED_EMAIL_DOMAINS ?? 'Not configured'}
              </span>
            </DetailRow>
            <DetailRow label="Clerk instance">
              <span className="text-[var(--fg-secondary)]">
                {usingClerk ? 'Production' : 'Not configured'}
              </span>
            </DetailRow>
          </dl>
        </Card>
      )}
    </div>
  );
}

function ConnectionCard({
  icon,
  title,
  description,
  status,
  accountInfo,
  lastSync,
  errorMessage,
  onConnect,
  onDisconnect,
  onSync,
}: ConnectionCardProps) {
  const isConnected = status === 'connected';
  const isError = status === 'error';

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--border-subtle)] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">{icon}</div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--fg-primary)]">{title}</span>
            <Badge
              tone={isConnected ? 'jade' : isError ? 'tomato' : 'gray'}
              className="text-[10px]"
            >
              {isConnected ? 'Connected' : isError ? 'Error' : 'Not connected'}
            </Badge>
          </div>
          <div className="mt-0.5 text-xs text-[var(--fg-secondary)]">{description}</div>
          {accountInfo ? (
            <div className="mt-1 text-xs text-[var(--fg-tertiary)]">{accountInfo}</div>
          ) : null}
          {lastSync ? (
            <div className="mt-1 text-xs text-[var(--fg-tertiary)]">Last sync: {lastSync}</div>
          ) : null}
          {errorMessage ? (
            <div className="mt-1 text-xs text-[var(--danger)]">{errorMessage}</div>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:shrink-0">
        {isConnected && onSync ? (
          <button
            type="button"
            onClick={onSync}
            className="btn btn-secondary btn-sm"
          >
            Sync now
          </button>
        ) : null}
        {isConnected && onDisconnect ? (
          <button
            type="button"
            onClick={onDisconnect}
            className="btn btn-ghost btn-sm text-[var(--danger)]"
          >
            Disconnect
          </button>
        ) : null}
        {!isConnected && onConnect ? (
          <button
            type="button"
            onClick={onConnect}
            className="btn btn-primary btn-sm"
          >
            Connect
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}
