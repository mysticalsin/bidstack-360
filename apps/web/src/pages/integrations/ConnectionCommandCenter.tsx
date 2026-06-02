/**
 * integrations/ConnectionCommandCenter.tsx — connection path navigator and
 * detail panel for the Integrations overview tab.
 *
 * WHY a separate module: ConnectionCommandCenter (~165 lines) and
 * ConnectionPathPanel (~47 lines) form one cohesive "pick a path" flow.
 * Extracting them with the local PATHS constant keeps the overview tab clean
 * and makes the command-center independently testable.
 */
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { Icon, type IconName } from '@/components/ui/Icon';
import { LiquidGlassButton } from '@/components/ui/LiquidGlassButton';
import { relativeTime } from '@/lib/format';

import { EndpointBox, SnippetBox } from './IntegrationAtoms';
import { getPathDetail, readinessBadgeLabel } from './integration-helpers';
import type { IntegrationSetupGuide } from './types';

// ─── Path catalogue ────────────────────────────────────────────────────────────

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

// ─── ConnectionPathPanel ────────────────────────────────────────────────────────

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
        <Badge tone={detail.ready ? 'jade' : 'amber'}>
          {detail.ready ? 'ready' : 'needs setup'}
        </Badge>
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

// ─── ConnectionCommandCenter ───────────────────────────────────────────────────

export function ConnectionCommandCenter({
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
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-secondary)]">
                {item.label}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[var(--fg-primary)]">{item.value}</span>
                <Badge tone={item.tone}>{readinessBadgeLabel(item.tone)}</Badge>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-0 xl:grid-cols-[320px_1fr]">
        <div className="border-b border-[var(--border-subtle)] p-3 xl:border-b-0 xl:border-r">
          <div role="tablist" aria-label="Integration setup paths" className="space-y-2">
            {PATHS.map((path) => {
              const isActive = active === path.key;
              return (
                <button
                  key={path.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActive(path.key)}
                  className={`flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] ${
                    isActive
                      ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)]'
                      : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--surface-sunken)]'
                  }`}
                >
                  <span className="mt-0.5 text-[var(--brand-primary)]">
                    <Icon name={path.icon} size={17} />
                  </span>
                  <span>
                    <span
                      className={`block text-[10px] font-semibold uppercase tracking-wider ${
                        isActive ? 'text-[var(--fg-secondary)]' : 'text-[var(--fg-tertiary)]'
                      }`}
                    >
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
              );
            })}
          </div>
        </div>

        <div className="p-5">
          <ConnectionPathPanel path={activePath} guide={guide} />
        </div>
      </div>
    </Card>
  );
}
