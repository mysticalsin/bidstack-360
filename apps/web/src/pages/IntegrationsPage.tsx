import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { ConnectorsSection } from '@/components/integrations/ConnectorsSection';
import { DataQualitySection } from '@/components/integrations/DataQualitySection';
import { ErpConnectorCard } from '@/components/integrations/ErpConnectorCard';
import { ProviderHealthSection } from '@/components/integrations/ProviderHealthSection';
import { ApiKeysSection } from '@/components/settings/ApiKeysSection';
import { WebhooksSection } from '@/components/settings/WebhooksSection';
import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { LiquidGlassButton } from '@/components/ui/LiquidGlassButton';
import { ErrorState } from '@/components/ui/StateMessages';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { UpgradeBanner } from '@/components/ui/UpgradeBanner';
import { useIsAdmin } from '@/lib/auth';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

import { Stat } from './integrations/IntegrationAtoms';
import { ConnectionCommandCenter } from './integrations/ConnectionCommandCenter';
import { ConnectionRunway } from './integrations/ConnectionRunway';
import { ConnectionTester } from './integrations/ConnectionTester';
import { DustAgentsCard } from './integrations/DustAgentsCard';
import { DustCredentialsCard } from './integrations/DustCredentialsCard';
import { IntegrationHero } from './integrations/IntegrationHero';
import { WebhookEventsCard } from './integrations/WebhookEventsCard';
import { buildIntegrationSummary } from './integrations/integration-helpers';
import { MCP_TOOLS } from './integrations/types';
import type { DustStatus, IntegrationSetupGuide, WebhookEvent } from './integrations/types';

export function IntegrationsPage() {
  const isAdmin = useIsAdmin();
  const [activeTab, setActiveTab] = useState('overview');

  const setupGuide = useQuery({
    queryKey: ['integrations:setup-guide'],
    queryFn: ({ signal }) =>
      api<IntegrationSetupGuide>('/api/integrations/setup-guide', { signal }),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const status = useQuery({
    queryKey: ['dust:status'],
    queryFn: ({ signal }) => api<DustStatus>('/api/integrations/dust/status', { signal }),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const events = useQuery({
    queryKey: ['webhooks'],
    queryFn: ({ signal }) =>
      api<{ items: WebhookEvent[] }>('/api/integrations/webhooks', { signal }),
  });
  const isError = setupGuide.isError || status.isError || events.isError;
  const summary = useMemo(
    () => buildIntegrationSummary(setupGuide.data, status.data, events.data?.items ?? []),
    [events.data?.items, setupGuide.data, status.data],
  );

  return (
    <div className="space-y-5 px-6 pb-10 pt-6">
      <IntegrationHero
        activeTab={activeTab}
        isLoading={setupGuide.isLoading || status.isLoading || events.isLoading}
        summary={summary}
        onCreateApiKey={() => setActiveTab('developer')}
        onAddWebhook={() => setActiveTab('developer')}
      />

      <UpgradeBanner
        title="Agent and CRM connections"
        message="Connect Dust agents, webhooks, and CRM sync monitoring from one place."
        actionLabel="Manage agents"
        href="/agents"
      />

      {isError ? (
        <ErrorState
          title="Could not load integrations"
          message="Some integration data failed to load. Please try again."
          action={
            <button
              type="button"
              onClick={() => {
                if (setupGuide.isError) void setupGuide.refetch();
                if (status.isError) void status.refetch();
                if (events.isError) void events.refetch();
              }}
              className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-medium text-fg-on-brand hover:bg-brand-hover"
            >
              Retry
            </button>
          }
        />
      ) : null}

      <ConnectionRunway />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-6">
        <TabsList className="flex flex-wrap items-center gap-1 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-1 shadow-[var(--shadow-xs)]">
          <TabsTrigger value="overview" className="gap-2">
            <Icon name="sliders" size={14} />
            <span>Overview & Health</span>
          </TabsTrigger>
          <TabsTrigger value="agents" className="gap-2">
            <Icon name="sparkle" size={14} />
            <span>AI & Agents</span>
          </TabsTrigger>
          <TabsTrigger value="connectors" className="gap-2">
            <Icon name="globe" size={14} />
            <span>ERP & Connectors</span>
          </TabsTrigger>
          <TabsTrigger value="developer" className="gap-2">
            <Icon name="settings" size={14} />
            <span>Developer Tools</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-5 outline-none">
          <ConnectionCommandCenter
            guide={setupGuide.data}
            isLoading={setupGuide.isLoading}
            isError={setupGuide.isError}
            onRetry={() => setupGuide.refetch()}
            dustConfigured={status.data?.configured ?? false}
            dustAgents={status.data?.agents.length ?? 0}
          />
          <ConnectionTester guide={setupGuide.data} isLoading={setupGuide.isLoading} />
          <ProviderHealthSection />
          <WebhookEventsCard events={events.data?.items ?? []} isLoading={events.isLoading} />
        </TabsContent>

        <TabsContent value="agents" className="space-y-6 outline-none">
          <DustCredentialsCard />

          <Card>
            <SectionHeader
              title="Dust workspace"
              caption={status.data?.workspace}
              action={
                <div className="flex items-center gap-2">
                  {status.data ? (
                    <Badge tone={status.data.configured ? 'jade' : 'amber'}>
                      {status.data.configured ? 'Configured' : 'Not configured'}
                    </Badge>
                  ) : null}
                  {isAdmin ? (
                    <LiquidGlassButton
                      tone="secondary"
                      size="sm"
                      onClick={() => {
                        void api('/api/integrations/dust/resync', { method: 'POST' }).then(() =>
                          status.refetch(),
                        );
                      }}
                    >
                      Run sync now
                    </LiquidGlassButton>
                  ) : null}
                </div>
              }
            />
            <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
              <Stat
                label="Last sync"
                value={status.data?.lastSyncAt ? formatDate(status.data.lastSyncAt) : 'n/a'}
              />
              <Stat
                label="Next sync"
                value={status.data?.nextSyncAt ? formatDate(status.data.nextSyncAt) : 'n/a'}
              />
              <Stat label="Pulled 24h" value={status.data?.pulled24h.toString() ?? 'n/a'} />
              <Stat label="Pushed 24h" value={status.data?.pushed24h.toString() ?? 'n/a'} />
            </div>
            {status.data?.lastError ? (
              <div className="mx-5 mb-5 rounded-md bg-[var(--danger-tint)] px-3 py-2 text-xs text-[var(--danger)]">
                {status.data.lastError}
              </div>
            ) : null}
          </Card>

          <DustAgentsCard data={status.data} isLoading={status.isLoading} />

          <Card>
            <SectionHeader
              title="MCP tools"
              caption="Canonical crm_* names are consumed by Dust; legacy dotted names remain for v0.1 clients."
            />
            <ul className="divide-y divide-[var(--border-subtle)]">
              {MCP_TOOLS.map((tool) => (
                <li key={tool.name} className="flex items-start justify-between gap-4 px-5 py-3">
                  <div>
                    <code className="font-mono text-xs text-[var(--brand-primary)]">
                      {tool.name}
                    </code>
                    <p className="mt-0.5 text-xs text-[var(--fg-secondary)]">{tool.desc}</p>
                  </div>
                  <Badge tone={tool.group === 'crm' ? 'jade' : 'gray'}>
                    {tool.group === 'crm' ? 'active' : 'legacy'}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        </TabsContent>

        <TabsContent value="connectors" className="space-y-6 outline-none">
          <ErpConnectorCard />
          <ConnectorsSection />
          <DataQualitySection />
        </TabsContent>

        <TabsContent value="developer" className="space-y-6 outline-none">
          <section id="api-keys" className="scroll-mt-24">
            <ApiKeysSection />
          </section>
          <section id="webhooks" className="scroll-mt-24">
            <WebhooksSection />
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
