import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { ConnectorsSection } from '@/components/integrations/ConnectorsSection';
import { DataQualitySection } from '@/components/integrations/DataQualitySection';
import { ErpConnectorCard } from '@/components/integrations/ErpConnectorCard';
import { ProviderHealthSection } from '@/components/integrations/ProviderHealthSection';
import { ApiKeysSection } from '@/components/settings/ApiKeysSection';
import { WebhooksSection } from '@/components/settings/WebhooksSection';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { LiquidGlassButton } from '@/components/ui/LiquidGlassButton';
import { toast } from '@/components/ui/Toast';
import { useIsAdmin } from '@/lib/auth';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { UpgradeBanner } from '@/components/ui/UpgradeBanner';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, relativeTime } from '@/lib/format';

interface DustStatus {
  workspace: string;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  lastError: string | null;
  pulled24h: number;
  pushed24h: number;
  configured: boolean;
  agentsError: string | null;
  agents: Array<{ id: string; label: string; description: string | null }>;
}

interface WebhookEvent {
  id: string;
  receivedAt: string;
  source: string;
  eventType: string;
  status: string;
  error: string | null;
}

interface IntegrationSetupGuide {
  generatedAt: string;
  dust: {
    configured: boolean;
    workspaceId: string | null;
    dataSourceConfigured: boolean;
    webhookReceiverUrl: string;
  };
  mcp: {
    publicUrl: string;
    healthUrl: string;
    wellKnownUrl: string;
    transport: 'streamable-http';
    configured: boolean;
    readScopes: string[];
    writeScopes: string[];
  };
  rest: {
    baseUrl: string;
    authHeader: string;
    recommendedScopes: string[];
  };
  webhooks: {
    subscriptionsUrl: string;
    receiverUrl: string;
    requiredHeaders: string[];
    recommendedEvents: string[];
  };
  snippets: {
    dustMcpToolConfig: string;
    mcpHealthCheck: string;
    restOpportunitySearch: string;
    webhookReceiver: string;
  };
}

type ProbeKind = 'mcp' | 'rest' | 'webhook';

interface IntegrationProbeResult {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  checkedUrl: string;
  message: string;
  warnings: string[];
}

// Mirrors apps/mcp-server/src/tools/index.ts. Two namespaces ship side by side:
// the canonical Dust-facing `crm_*` surface and the legacy dotted MCP names
// retained for v0.1 clients.
type McpToolEntry = { name: string; desc: string; group: 'crm' | 'legacy' };

const MCP_TOOLS: ReadonlyArray<McpToolEntry> = [
  {
    group: 'crm',
    name: 'crm_search_companies',
    desc: 'Fuzzy search the company graph by name, domain, or registry.',
  },
  {
    group: 'crm',
    name: 'crm_enrich_company',
    desc: 'Request company data verification and refresh the cache.',
  },
  { group: 'crm', name: 'crm_create_deal', desc: 'Create an opportunity tied to a customer.' },
  {
    group: 'crm',
    name: 'crm_update_deal',
    desc: 'Patch deal fields and write an audit log entry.',
  },
  { group: 'crm', name: 'crm_list_activities', desc: 'List activities for a company or deal.' },
  {
    group: 'crm',
    name: 'crm_create_activity',
    desc: 'Log a new activity against a deal or contact.',
  },
  {
    group: 'crm',
    name: 'crm_generate_insights',
    desc: 'Generate draft insights from available CRM data for a deal or account.',
  },
  { group: 'legacy', name: 'opportunities.list', desc: 'List opportunities matching filters.' },
  {
    group: 'legacy',
    name: 'opportunities.get',
    desc: 'Fetch one opportunity with related CRM context.',
  },
  { group: 'legacy', name: 'opportunity.update', desc: 'Patch fields and write audit log.' },
  { group: 'legacy', name: 'contacts.list', desc: 'List decision-unit contacts by customer.' },
  { group: 'legacy', name: 'tasks.create', desc: 'Create a follow-up task on an opportunity.' },
  {
    group: 'legacy',
    name: 'proposal.draft',
    desc: 'Draft a proposal section using available customer context.',
  },
];

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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-5">
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
                    <code className="font-mono text-xs text-[var(--brand-primary)]">{tool.name}</code>
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

interface IntegrationSummary {
  readyPaths: number;
  pathTotal: number;
  dustAgents: number;
  webhookEvents: number;
  attentionEvents: number;
  activeMcpTools: number;
  latestSyncLabel: string;
  postureLabel: string;
  postureTone: BadgeTone;
}

function buildIntegrationSummary(
  guide: IntegrationSetupGuide | undefined,
  dust: DustStatus | undefined,
  events: WebhookEvent[],
): IntegrationSummary {
  const pathStates = [
    Boolean(guide?.dust.configured && guide?.mcp.configured),
    Boolean(guide?.mcp.configured),
    Boolean(guide?.rest.baseUrl),
    Boolean(guide?.webhooks.subscriptionsUrl),
  ];
  const attentionEvents = events.filter((event) => event.status === 'error').length;
  const needsSetup =
    !guide || !guide.mcp.configured || !guide.dust.configured || !guide.dust.dataSourceConfigured;

  return {
    readyPaths: pathStates.filter(Boolean).length,
    pathTotal: pathStates.length,
    dustAgents: dust?.agents.length ?? 0,
    webhookEvents: events.length,
    attentionEvents,
    activeMcpTools: MCP_TOOLS.filter((tool) => tool.group === 'crm').length,
    latestSyncLabel: dust?.lastSyncAt ? relativeTime(dust.lastSyncAt) : 'Not synced',
    postureLabel: needsSetup ? 'Needs setup' : attentionEvents > 0 ? 'Review events' : 'Ready',
    postureTone: needsSetup ? 'amber' : attentionEvents > 0 ? 'tomato' : 'jade',
  };
}

function IntegrationHero({
  activeTab,
  isLoading,
  summary,
  onCreateApiKey,
  onAddWebhook,
}: {
  activeTab: string;
  isLoading: boolean;
  summary: IntegrationSummary;
  onCreateApiKey: () => void;
  onAddWebhook: () => void;
}) {
  return (
    <section className="relative overflow-hidden rounded-[28px] border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-6 shadow-[var(--shadow-soft)]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent-primary)]/35 to-transparent" />
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="blue">Integration fabric</Badge>
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
              MCP, REST, webhooks, Dust
            </span>
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
              Integrations
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
              Connect agents, APIs, ERP systems and event streams with clear setup paths, scoped
              credentials and live health checks that fit the rest of the CRM.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center lg:flex-col lg:items-end">
          <div
            role="status"
            aria-live="polite"
            className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-3 text-xs font-medium text-[var(--text-secondary)]"
          >
            <span
              className={cn(
                'size-2 rounded-full',
                summary.postureTone === 'jade'
                  ? 'bg-[var(--tag-jade-fg)] shadow-[0_0_0_4px_var(--tag-jade-bg)]'
                  : summary.postureTone === 'tomato'
                    ? 'bg-[var(--tag-tomato-fg)] shadow-[0_0_0_4px_var(--tag-tomato-bg)]'
                    : 'bg-[var(--tag-amber-fg)] shadow-[0_0_0_4px_var(--tag-amber-bg)]',
              )}
            />
            {isLoading ? 'Refreshing integration posture...' : summary.postureLabel}
          </div>
          <div className="flex flex-wrap gap-2">
            <LiquidGlassButton tone="secondary" size="sm" onClick={onCreateApiKey}>
              Create API key
            </LiquidGlassButton>
            <LiquidGlassButton tone="secondary" size="sm" onClick={onAddWebhook}>
              Add webhook
            </LiquidGlassButton>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <IntegrationMetricCard
          icon="git-branch"
          label="Ready paths"
          value={
            <AnimatedMetric value={`${summary.readyPaths} of ${summary.pathTotal}`} duration={0.7} />
          }
          tone={summary.readyPaths === summary.pathTotal ? 'jade' : 'amber'}
          helper={activeTab === 'overview' ? 'Current view' : 'Overview tab'}
        />
        <IntegrationMetricCard
          icon="sparkle"
          label="Dust agents"
          value={<AnimatedMetric value={String(summary.dustAgents)} />}
          tone={summary.dustAgents > 0 ? 'purple' : 'gray'}
          helper={summary.latestSyncLabel}
        />
        <IntegrationMetricCard
          icon="bell"
          label="Webhook events"
          value={<AnimatedMetric value={String(summary.webhookEvents)} />}
          tone={summary.attentionEvents > 0 ? 'tomato' : 'blue'}
          helper={
            summary.attentionEvents > 0
              ? `${summary.attentionEvents} need review`
              : 'No event errors loaded'
          }
        />
        <IntegrationMetricCard
          icon="shield"
          label="Active MCP tools"
          value={<AnimatedMetric value={String(summary.activeMcpTools)} />}
          tone="teal"
          helper="Dust-facing crm_* tools"
        />
        <IntegrationMetricCard
          icon="globe"
          label="Control plane"
          value={summary.postureLabel}
          tone={summary.postureTone}
          helper="Least-privilege setup"
        />
      </div>
    </section>
  );
}

function IntegrationMetricCard({
  icon,
  label,
  value,
  tone,
  helper,
}: {
  icon: IconName;
  label: string;
  value: ReactNode;
  tone: BadgeTone;
  helper: string;
}) {
  return (
    <Card className="min-h-[128px] border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-4">
      <div className="flex h-full flex-col justify-between gap-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
            {label}
          </span>
          <span className="grid size-9 place-items-center rounded-2xl bg-[var(--surface-primary)] text-[var(--text-secondary)]">
            <Icon name={icon} className="size-4" />
          </span>
        </div>
        <div>
          <div className="text-2xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
            {value}
          </div>
          <Badge tone={tone} className="mt-2">
            {helper}
          </Badge>
        </div>
      </div>
    </Card>
  );
}

const RUNWAY_STEPS: Array<{
  icon: IconName;
  title: string;
  body: string;
  tone: BadgeTone;
}> = [
  {
    icon: 'sliders',
    title: 'Pick the surface',
    body: 'Choose MCP for agents, REST for sync, webhooks for events, or connectors for ERP.',
    tone: 'blue',
  },
  {
    icon: 'shield',
    title: 'Scope access',
    body: 'Create read/write keys only for the exact workflow and keep secrets server-side.',
    tone: 'teal',
  },
  {
    icon: 'clock',
    title: 'Probe before save',
    body: 'Run a safe reachability check with SSRF protection and no bearer tokens sent.',
    tone: 'amber',
  },
  {
    icon: 'reports',
    title: 'Monitor evidence',
    body: 'Review provider health and webhook events without leaving the integration hub.',
    tone: 'jade',
  },
];

function ConnectionRunway() {
  return (
    <section className="grid gap-3 xl:grid-cols-4" aria-label="Integration setup workflow">
      {RUNWAY_STEPS.map((step, index) => (
        <Card
          key={step.title}
          className="border-[var(--border-subtle)] bg-[var(--surface-primary)] p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[var(--surface-secondary)] text-[var(--text-secondary)]">
              <Icon name={step.icon} className="size-4" />
            </span>
            <Badge tone={step.tone}>Step {index + 1}</Badge>
          </div>
          <h2 className="mt-4 text-base font-semibold text-[var(--text-primary)]">
            {step.title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{step.body}</p>
        </Card>
      ))}
    </section>
  );
}

function WebhookEventsCard({
  events,
  isLoading,
}: {
  events: WebhookEvent[];
  isLoading: boolean;
}) {
  const errorCount = events.filter((event) => event.status === 'error').length;

  return (
    <Card className="overflow-hidden border-[var(--border-subtle)] bg-[var(--surface-primary)]">
      <SectionHeader
        title="Recent webhook events"
        caption="A live evidence stream for Dust callbacks, CRM event subscribers and external automations."
        action={
          <Badge tone={errorCount > 0 ? 'tomato' : events.length > 0 ? 'jade' : 'gray'}>
            {errorCount > 0 ? `${errorCount} errors` : events.length > 0 ? 'processing' : 'quiet'}
          </Badge>
        }
      />
      {isLoading ? (
        <div className="p-5">
          <LoadingSkeleton rows={4} />
        </div>
      ) : events.length === 0 ? (
        <div className="grid min-h-[220px] place-items-center px-6 py-10 text-center">
          <div className="max-w-sm">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--surface-secondary)] text-[var(--text-secondary)]">
              <Icon name="bell" className="size-5" />
            </span>
            <h3 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">
              No webhook events yet
            </h3>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              Once Dust or another system calls back, events appear here with status, source and
              timing.
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto" role="region" aria-label="Recent webhook events table">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <caption className="sr-only">Recent webhook events, newest first</caption>
            <thead className="bg-[var(--surface-secondary)] text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">
              <tr>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Event
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Source
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Received
                </th>
                <th scope="col" className="px-5 py-3 text-right font-semibold">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr
                  key={event.id}
                  className="border-b border-[var(--border-subtle)] align-top transition hover:bg-[var(--surface-secondary)]/70"
                >
                  <td className="px-5 py-4">
                    <div className="font-mono text-xs text-[var(--text-primary)]">
                      {event.eventType}
                    </div>
                    {event.error ? (
                      <p className="mt-1 text-xs text-[var(--danger)]">{event.error}</p>
                    ) : (
                      <p className="mt-1 text-xs text-[var(--text-muted)]">
                        Event accepted by the integration receiver.
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <Badge tone={event.source === 'dust.webhook' ? 'purple' : 'gray'}>
                      {event.source}
                    </Badge>
                  </td>
                  <td className="px-5 py-4 text-xs tabular-nums text-[var(--text-secondary)]">
                    {relativeTime(event.receivedAt)}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Badge tone={webhookStatusTone(event.status)}>{event.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function webhookStatusTone(status: string): BadgeTone {
  if (status === 'processed') return 'jade';
  if (status === 'error') return 'tomato';
  return 'gray';
}

type PathKey = 'dust' | 'mcp' | 'rest' | 'webhooks';

const PATHS: Array<{
  key: PathKey;
  icon: IconName;
  title: string;
  eyebrow: string;
  summary: string;
}> = [
  {
    key: 'dust',
    icon: 'sparkle',
    title: 'Dust agent bridge',
    eyebrow: 'Agent actions',
    summary: 'Give Dust a server-side CRM toolbelt with MCP plus REST sync.',
  },
  {
    key: 'mcp',
    icon: 'git-branch',
    title: 'MCP server',
    eyebrow: 'Custom tools',
    summary: 'Register BidStack as an MCP server for Dust, Claude Desktop, or internal agents.',
  },
  {
    key: 'rest',
    icon: 'globe',
    title: 'REST API',
    eyebrow: 'Bi-directional data',
    summary: 'Use typed API keys for ETL jobs, client portals, and enterprise automation.',
  },
  {
    key: 'webhooks',
    icon: 'bell',
    title: 'Webhooks',
    eyebrow: 'Realtime events',
    summary: 'Subscribe external systems to deal, bid, proposal, invoice, and agent events.',
  },
];
const DEFAULT_PATH = PATHS[1]!;

function ConnectionCommandCenter({
  guide,
  isLoading,
  isError,
  onRetry,
  dustConfigured,
  dustAgents,
}: {
  guide?: IntegrationSetupGuide;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  dustConfigured: boolean;
  dustAgents: number;
}) {
  const [active, setActive] = useState<PathKey>('mcp');

  if (isLoading) {
    return (
      <Card>
        <SectionHeader
          title="Connection command center"
          caption="Loading the live API, MCP, Dust, and webhook contract."
        />
        <div className="p-5">
          <LoadingSkeleton rows={5} />
        </div>
      </Card>
    );
  }

  if (isError || !guide) {
    return (
      <Card>
        <ErrorState
          title="Could not load setup guide"
          message="The integration contract endpoint did not respond."
          action={
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Retry setup guide
            </Button>
          }
        />
      </Card>
    );
  }

  const activePath = PATHS.find((path) => path.key === active) ?? DEFAULT_PATH;
  const readiness = [
    {
      label: 'Dust credentials',
      value: dustConfigured ? 'Ready' : 'Needs key',
      tone: dustConfigured ? 'jade' : 'amber',
    },
    {
      label: 'Dust agents',
      value: dustConfigured ? `${dustAgents} found` : 'Disabled',
      tone: dustConfigured && dustAgents > 0 ? 'teal' : dustConfigured ? 'blue' : 'gray',
    },
    {
      label: 'MCP endpoint',
      value: guide.mcp.configured ? 'Public URL set' : 'Local fallback',
      tone: guide.mcp.configured ? 'jade' : 'amber',
    },
    {
      label: 'Dust data source',
      value: guide.dust.dataSourceConfigured ? 'Ready' : 'Missing',
      tone: guide.dust.dataSourceConfigured ? 'jade' : 'amber',
    },
  ] as const;

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-[var(--border-subtle)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)] text-[var(--brand-primary)]">
                <Icon name="link" size={18} />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-[var(--fg-primary)]">
                  Connection command center
                </h2>
                <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">
                  Generated {relativeTime(guide.generatedAt)}
                </p>
              </div>
            </div>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-[var(--fg-secondary)]">
              Pick a path, create the right key, copy the exact endpoint, and connect the external
              system with least-privilege scopes.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <LiquidGlassButton as="a" href="#api-keys" tone="secondary" size="sm">
              Key vault
            </LiquidGlassButton>
            <LiquidGlassButton as="a" href="#webhooks" tone="secondary" size="sm">
              Webhook hub
            </LiquidGlassButton>
          </div>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {readiness.map((item) => (
            <div
              key={item.label}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3"
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                {item.label}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[var(--fg-primary)]">
                  {item.value}
                </span>
                <Badge tone={item.tone}>{readinessBadgeLabel(item.tone)}</Badge>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-0 xl:grid-cols-[320px_1fr]">
        <div className="border-b border-[var(--border-subtle)] p-3 xl:border-b-0 xl:border-r">
          <div role="tablist" aria-label="Integration setup paths" className="space-y-2">
            {PATHS.map((path) => (
              <button
                key={path.key}
                type="button"
                role="tab"
                aria-selected={active === path.key}
                onClick={() => setActive(path.key)}
                className={`flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] ${
                  active === path.key
                    ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)]'
                    : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--surface-sunken)]'
                }`}
              >
                <span className="mt-0.5 text-[var(--brand-primary)]">
                  <Icon name={path.icon} size={17} />
                </span>
                <span>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                    {path.eyebrow}
                  </span>
                  <span className="mt-0.5 block text-sm font-semibold text-[var(--fg-primary)]">
                    {path.title}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--fg-secondary)]">
                    {path.summary}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="p-5">
          <ConnectionPathPanel path={activePath} guide={guide} />
        </div>
      </div>
    </Card>
  );
}

function ConnectionPathPanel({
  path,
  guide,
}: {
  path: (typeof PATHS)[number];
  guide: IntegrationSetupGuide;
}) {
  const detail = getPathDetail(path.key, guide);
  return (
    <div role="tabpanel" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
            {path.eyebrow}
          </div>
          <h3 className="mt-1 text-xl font-semibold text-[var(--fg-primary)]">{path.title}</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--fg-secondary)]">
            {detail.description}
          </p>
        </div>
        <Badge tone={detail.ready ? 'jade' : 'amber'}>{detail.ready ? 'ready' : 'needs setup'}</Badge>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {detail.steps.map((step, index) => (
          <div
            key={step.title}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3"
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--surface-card)] text-xs font-semibold text-[var(--fg-primary)]">
                {index + 1}
              </span>
              <div className="text-sm font-semibold text-[var(--fg-primary)]">{step.title}</div>
            </div>
            <p className="mt-2 text-xs leading-5 text-[var(--fg-secondary)]">{step.body}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
        <EndpointBox label={detail.endpointLabel} value={detail.endpoint} />
        <SnippetBox label={detail.snippetLabel} value={detail.snippet} />
      </div>
    </div>
  );
}

function getPathDetail(key: PathKey, guide: IntegrationSetupGuide) {
  if (key === 'dust') {
    return {
      ready: guide.dust.configured && guide.mcp.configured,
      description:
        'Use REST to push knowledge into Dust data sources, then let Dust call BidStack through the public MCP endpoint.',
      endpointLabel: 'Dust webhook receiver',
      endpoint: guide.dust.webhookReceiverUrl,
      snippetLabel: 'Dust MCP tool config',
      snippet: guide.snippets.dustMcpToolConfig,
      steps: [
        {
          title: 'Create a scoped key',
          body: 'Use mcp + read for research agents. Add write only for approved automation agents.',
        },
        {
          title: 'Register the MCP tool',
          body: 'Paste the public MCP URL in Dust and set the Authorization bearer header.',
        },
        {
          title: 'Sync source evidence',
          body: 'Push proposals, opportunity briefs, and audit references through the REST data-source path.',
        },
      ],
    };
  }
  if (key === 'rest') {
    return {
      ready: true,
      description:
        'REST is the stable bi-directional interface for data sync, ETL, portals, and enterprise middleware.',
      endpointLabel: 'REST base URL',
      endpoint: guide.rest.baseUrl,
      snippetLabel: 'Opportunity search example',
      snippet: guide.snippets.restOpportunitySearch,
      steps: [
        {
          title: 'Choose scopes',
          body: `Recommended scopes: ${guide.rest.recommendedScopes.join(' + ')}. Avoid write for reporting jobs.`,
        },
        {
          title: 'Send bearer auth',
          body: guide.rest.authHeader,
        },
        {
          title: 'Make writes idempotent',
          body: 'External systems should send stable ids and retry safely when jobs or webhooks time out.',
        },
      ],
    };
  }
  if (key === 'webhooks') {
    return {
      ready: true,
      description:
        'Outbound subscriptions notify external systems when CRM events need realtime follow-up.',
      endpointLabel: 'Subscriptions API',
      endpoint: guide.webhooks.subscriptionsUrl,
      snippetLabel: 'Dust receiver test shape',
      snippet: guide.snippets.webhookReceiver,
      steps: [
        {
          title: 'Add HTTPS endpoint',
          body: 'Private/internal URLs are rejected before save to avoid SSRF risk.',
        },
        {
          title: 'Select events',
          body: `Start with ${guide.webhooks.recommendedEvents.slice(0, 3).join(', ')}.`,
        },
        {
          title: 'Verify signatures',
          body: `Expect ${guide.webhooks.requiredHeaders.join(', ')} on inbound Dust callbacks.`,
        },
      ],
    };
  }
  return {
    ready: guide.mcp.configured,
    description:
      'MCP gives agents a controlled tool surface. Read tools require mcp + read; write tools require mcp + write.',
    endpointLabel: 'MCP Streamable HTTP URL',
    endpoint: guide.mcp.publicUrl,
    snippetLabel: 'MCP health check',
    snippet: guide.snippets.mcpHealthCheck,
    steps: [
      {
        title: 'Expose the endpoint',
        body: guide.mcp.configured
          ? 'DUST_MCP_PUBLIC_URL is configured for external agent clients.'
          : 'Local fallback is shown. Set DUST_MCP_PUBLIC_URL before production use.',
      },
      {
        title: 'Create least-privilege key',
        body: `Read: ${guide.mcp.readScopes.join(' + ')}. Write: ${guide.mcp.writeScopes.join(' + ')}.`,
      },
      {
        title: 'Check discovery',
        body: `Discovery is available at ${guide.mcp.wellKnownUrl}.`,
      },
    ],
  };
}

const PROBE_OPTIONS: Array<{
  key: ProbeKind;
  label: string;
  icon: IconName;
  description: string;
}> = [
  { key: 'mcp', label: 'MCP', icon: 'git-branch', description: 'Agent tool endpoints' },
  { key: 'rest', label: 'REST API', icon: 'globe', description: 'Data sync endpoints' },
  { key: 'webhook', label: 'Webhook', icon: 'bell', description: 'Event receivers' },
];

function ConnectionTester({
  guide,
  isLoading,
}: {
  guide?: IntegrationSetupGuide;
  isLoading: boolean;
}) {
  const [kind, setKind] = useState<ProbeKind>('mcp');
  const [urlInput, setUrlInput] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [result, setResult] = useState<IntegrationProbeResult | null>(null);
  const resolvedUrl = urlInput ?? (guide ? defaultProbeUrl(kind, guide) : '');

  const chooseKind = (nextKind: ProbeKind) => {
    setKind(nextKind);
    setResult(null);
    setUrlInput(guide ? defaultProbeUrl(nextKind, guide) : null);
  };

  const runProbe = async () => {
    const nextUrl = resolvedUrl.trim();
    if (!nextUrl) {
      toast.error('Add an endpoint URL first');
      return;
    }
    setIsTesting(true);
    setResult(null);
    try {
      const response = await api<IntegrationProbeResult>('/api/integrations/probe', {
        method: 'POST',
        body: { kind, url: nextUrl },
      });
      setResult(response);
      if (response.ok) {
        toast.success('Endpoint reached', { description: response.message });
      } else {
        toast.error('Probe completed with a warning', { description: response.message });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Endpoint probe failed.';
      setResult({
        ok: false,
        status: null,
        latencyMs: 0,
        checkedUrl: safeUrlPreview(nextUrl),
        message,
        warnings: [],
      });
      toast.error('Probe blocked', { description: message });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Card>
      <SectionHeader
        title="Connection tester"
        caption="Probe an endpoint from the API service before saving it. Secrets and bearer tokens are never sent."
        action={
          <Badge tone={result?.ok ? 'jade' : result ? 'amber' : 'gray'}>
            {result?.ok ? 'reachable' : result ? 'needs attention' : 'ready to test'}
          </Badge>
        }
      />
      <div className="grid gap-4 p-5 xl:grid-cols-[300px_1fr]">
        <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
          {PROBE_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => chooseKind(option.key)}
              aria-pressed={kind === option.key}
              className={`flex min-h-16 items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] ${
                kind === option.key
                  ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)]'
                  : 'border-[var(--border-subtle)] bg-[var(--surface-sunken)] hover:border-[var(--border-strong)]'
              }`}
            >
              <span className="text-[var(--brand-primary)]">
                <Icon name={option.icon} size={17} />
              </span>
              <span>
                <span className="block text-sm font-semibold text-[var(--fg-primary)]">
                  {option.label}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--fg-secondary)]">
                  {option.description}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
              Endpoint URL
            </span>
            <div className="flex flex-col gap-2 lg:flex-row">
              <input
                value={resolvedUrl}
                onChange={(event) => {
                  setUrlInput(event.target.value);
                  setResult(null);
                }}
                placeholder={isLoading ? 'Loading setup contract...' : 'https://api.example.com/mcp'}
                className="min-h-11 flex-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 font-mono text-sm text-[var(--fg-primary)] shadow-[var(--shadow-xs)] outline-none transition focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    if (!guide) return;
                    setUrlInput(defaultProbeUrl(kind, guide));
                    setResult(null);
                  }}
                  disabled={!guide || isTesting}
                >
                  Use default
                </Button>
                <Button type="button" onClick={runProbe} disabled={isTesting || !resolvedUrl.trim()}>
                  <Icon name={isTesting ? 'clock' : 'shield'} size={15} />
                  {isTesting ? 'Testing...' : 'Test endpoint'}
                </Button>
              </div>
            </div>
          </label>

          <div className="grid gap-3 lg:grid-cols-3">
            <ProbeHint
              icon="shield"
              title="No secrets sent"
              body="The API probes reachability only. It strips query strings, fragments, usernames, and passwords."
            />
            <ProbeHint
              icon="warning"
              title="SSRF guarded"
              body="Private networks and internal hosts are blocked outside local development before any request is made."
            />
            <ProbeHint
              icon="clock"
              title="Fast timeout"
              body="The probe stops after 5 seconds and records a scoped audit event for administrator traceability."
            />
          </div>

          {result ? <ProbeResultCard result={result} /> : null}
        </div>
      </div>
    </Card>
  );
}

function defaultProbeUrl(kind: ProbeKind, guide: IntegrationSetupGuide): string {
  if (kind === 'rest') return `${guide.rest.baseUrl}/opportunities?limit=1`;
  if (kind === 'webhook') return guide.webhooks.receiverUrl;
  return guide.mcp.publicUrl;
}

function readinessBadgeLabel(tone: 'jade' | 'amber' | 'teal' | 'blue' | 'gray'): string {
  if (tone === 'jade') return 'ok';
  if (tone === 'amber') return 'fix';
  if (tone === 'gray') return 'off';
  return 'live';
}

function safeUrlPreview(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return 'Invalid endpoint URL';
  }
}

function ProbeHint({
  icon,
  title,
  body,
}: {
  icon: IconName;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--fg-primary)]">
        <Icon name={icon} size={15} />
        {title}
      </div>
      <p className="mt-2 text-xs leading-5 text-[var(--fg-secondary)]">{body}</p>
    </div>
  );
}

function ProbeResultCard({ result }: { result: IntegrationProbeResult }) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        result.ok
          ? 'border-[rgba(34,197,94,0.35)] bg-[rgba(34,197,94,0.08)]'
          : 'border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)]'
      }`}
      role="status"
      data-testid="connection-probe-result"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full ${
              result.ok
                ? 'bg-[rgba(34,197,94,0.15)] text-[var(--success)]'
                : 'bg-[rgba(245,158,11,0.16)] text-[var(--warning)]'
            }`}
          >
            <Icon name={result.ok ? 'checkCircle' : 'warning'} size={17} />
          </span>
          <div>
            <div className="text-sm font-semibold text-[var(--fg-primary)]">{result.message}</div>
            <code className="mt-1 block break-all font-mono text-xs text-[var(--fg-secondary)]">
              {result.checkedUrl}
            </code>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={result.ok ? 'jade' : 'amber'}>
            {result.status ? `HTTP ${result.status}` : 'No response'}
          </Badge>
          <Badge tone="gray">{result.latencyMs}ms</Badge>
        </div>
      </div>
      {result.warnings.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs text-[var(--fg-secondary)]">
          {result.warnings.map((warning) => (
            <li key={warning} className="flex gap-2">
              <Icon name="warning" size={13} className="mt-0.5 shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function EndpointBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          {label}
        </div>
        <CopyButton value={value} label="Copy endpoint" />
      </div>
      <code className="block overflow-x-auto rounded-md bg-[var(--surface-card)] px-3 py-2 font-mono text-xs text-[var(--fg-primary)]">
        {value}
      </code>
    </div>
  );
}

function SnippetBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          {label}
        </div>
        <CopyButton value={value} label="Copy snippet" />
      </div>
      <pre className="max-h-48 overflow-auto rounded-md bg-[var(--surface-card)] px-3 py-2 text-xs text-[var(--fg-primary)]">
        <code>{value}</code>
      </pre>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success(copied ? 'Already copied' : 'Copied to clipboard');
          setTimeout(() => setCopied(false), 1600);
        } catch {
          toast.error('Copy failed', { description: 'Clipboard access was not available.' });
        }
      }}
    >
      <Icon name={copied ? 'checkCircle' : 'copy'} size={14} />
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

function DustAgentsCard({ data, isLoading }: { data?: DustStatus; isLoading: boolean }) {
  return (
    <Card>
      <SectionHeader
        title="Dust agents"
        caption="Workspace agents available for CRM data verification workflows"
        action={
          data?.agentsError ? (
            <Badge tone="tomato">degraded</Badge>
          ) : data?.configured ? (
            <Badge tone="jade">configured</Badge>
          ) : (
            <Badge tone="amber">disabled</Badge>
          )
        }
      />
      {isLoading ? (
        <div className="p-5">
          <LoadingSkeleton rows={3} />
        </div>
      ) : !data?.configured ? (
        <div className="px-5 py-6 text-sm text-[var(--fg-secondary)]">
          Add Dust credentials to list available workspace agents.
        </div>
      ) : data.agentsError ? (
        <div className="mx-5 my-5 rounded-md bg-[var(--danger-tint)] px-3 py-2 text-xs text-[var(--danger)]">
          {data.agentsError}
        </div>
      ) : data.agents.length === 0 ? (
        <div className="px-5 py-6 text-sm text-[var(--fg-secondary)]">
          Dust is configured, but no accessible agents were returned for this workspace.
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {data.agents.map((agent) => (
            <li key={agent.id} className="flex items-start justify-between gap-4 px-5 py-3">
              <div>
                <div className="text-sm font-semibold text-[var(--fg-primary)]">{agent.label}</div>
                <code className="mt-1 block font-mono text-xs text-[var(--brand-primary)]">
                  {agent.id}
                </code>
                {agent.description ? (
                  <p className="mt-1 text-xs text-[var(--fg-secondary)]">{agent.description}</p>
                ) : null}
              </div>
              <Badge tone="purple">agent</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-[var(--fg-primary)] tabular-nums">
        {value}
      </div>
    </div>
  );
}
