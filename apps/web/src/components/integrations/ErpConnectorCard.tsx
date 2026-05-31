import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { api } from '@/lib/api';

interface ErpStatus {
  configured: boolean;
  url: string | null;
  database: string | null;
  reachable: boolean;
  toolCount: number | null;
  lastError: string | null;
}

interface ErpPresalesKit {
  generatedAt: string;
  configured: boolean;
  reachable: boolean;
  modules: Array<{
    id: string;
    label: string;
    erpModels: string[];
    bidstackSurface: string;
    value: string;
    status: 'ready' | 'sidecar' | 'planned';
    availableTools: string[];
  }>;
  partnerAutocomplete: {
    inputs: string[];
    fallback: string;
    validates: string[];
  };
  fieldMap: Array<{ erp: string; bidstack: string; mode: 'read' | 'write' | 'enrich' }>;
  nextActions: string[];
  lastError: string | null;
}

interface ErpCompanyAutocomplete {
  generatedAt: string;
  configured: boolean;
  reachable: boolean;
  source: 'external_erp' | 'local' | 'mixed' | 'none';
  items: Array<{
    id: string;
    name: string;
    legalName: string | null;
    domain: string | null;
    website: string | null;
    vat: string | null;
    duns: string | null;
    phone: string | null;
    email: string | null;
    source: 'external_erp' | 'verified_data' | 'external_crm' | 'bidstack';
    confidence: number;
    matchKeys: string[];
    sourceUrl: string | null;
  }>;
  warnings: string[];
}

export function ErpConnectorCard() {
  const [query, setQuery] = useState('Mantu');
  const status = useQuery({
    queryKey: ['erp:status'],
    queryFn: ({ signal }) => api<ErpStatus>('/api/integrations/erp/status', { signal }),
  });
  const kit = useQuery({
    queryKey: ['erp:presales-kit'],
    queryFn: ({ signal }) => api<ErpPresalesKit>('/api/integrations/erp/presales-kit', { signal }),
  });
  const autocomplete = useQuery({
    queryKey: ['erp:company-autocomplete', query],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ q: query, limit: '5' });
      if (looksLikeDomain(query)) params.set('domain', query);
      return api<ErpCompanyAutocomplete>(`/api/integrations/erp/company-autocomplete?${params}`, {
        signal,
      });
    },
  });

  const tone = status.isError
    ? 'tomato'
    : !status.data
      ? 'gray'
      : !status.data.configured
        ? 'amber'
        : status.data.reachable
          ? 'jade'
          : 'tomato';
  const label = status.isError
    ? 'error'
    : !status.data
      ? 'checking'
      : !status.data.configured
        ? 'not configured'
        : status.data.reachable
          ? 'live'
          : 'unreachable';

  return (
    <Card>
      <SectionHeader
        title="ERP MCP"
        caption={status.data?.database ?? 'set ERP_MCP_URL + ERP_DB to enable'}
        action={<Badge tone={tone}>{label}</Badge>}
      />
      {status.isLoading ? (
        <div className="p-5">
          <LoadingSkeleton rows={2} />
        </div>
      ) : status.isError ? (
        <div className="p-5">
          <ErrorState
            title="Couldn't reach the ERP status endpoint"
            message="This is a connection problem, not a missing configuration. Please retry."
            action={
              <Button size="sm" variant="secondary" onClick={() => void status.refetch()}>
                Retry
              </Button>
            }
          />
        </div>
      ) : !status.data?.configured ? (
        <div className="px-5 py-6 text-sm text-[var(--fg-secondary)]">
          Set <code className="font-mono text-xs">ERP_MCP_URL</code> and optionally{' '}
          <code className="font-mono text-xs">ERP_DB</code> to reach the ERP MCP sidecar. Until
          then, BidStack uses local verified data and verified data connectors.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
            <Stat label="Endpoint" value={hostOf(status.data.url)} />
            <Stat label="Database" value={status.data.database ?? 'n/a'} />
            <Stat
              label="MCP tools"
              value={status.data.toolCount !== null ? status.data.toolCount.toString() : 'n/a'}
            />
            <Stat label="Status" value={status.data.reachable ? 'reachable' : 'unreachable'} />
          </div>
          {status.data.lastError ? (
            <div className="mx-5 mb-5 rounded-md bg-[var(--danger-tint)] px-3 py-2 text-xs text-[var(--danger)]">
              {status.data.lastError}
            </div>
          ) : null}
        </>
      )}

      <div className="border-t border-[var(--border-subtle)] p-5">
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
                  ERP bid operating kit
                </h3>
                <p className="mt-1 text-xs text-[var(--fg-secondary)]">
                  Partner, opportunity, quote, activity, document, and handoff patterns adapted for
                  BidStack presales.
                </p>
              </div>
              <Badge
                tone={kit.data?.reachable ? 'jade' : kit.data?.configured ? 'tomato' : 'amber'}
              >
                {kit.data?.reachable ? 'sidecar' : kit.data?.configured ? 'fix sidecar' : 'local'}
              </Badge>
            </div>
            {kit.isLoading ? (
              <div className="pt-4">
                <LoadingSkeleton rows={3} />
              </div>
            ) : (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {kit.data?.modules.slice(0, 6).map((module) => (
                  <div
                    key={module.id}
                    className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-xs font-semibold text-[var(--fg-primary)]">
                        {module.label}
                      </div>
                      <Badge
                        tone={
                          module.status === 'sidecar'
                            ? 'jade'
                            : module.status === 'planned'
                              ? 'tomato'
                              : 'blue'
                        }
                      >
                        {module.status}
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-[var(--fg-secondary)]">
                      {module.value}
                    </p>
                    <div className="mt-2 truncate font-mono text-[10px] text-[var(--fg-tertiary)]">
                      {module.erpModels.join(' / ')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)]">
            <div className="border-b border-[var(--border-subtle)] p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
                    Partner autocomplete
                  </h3>
                  <p className="mt-1 text-xs text-[var(--fg-secondary)]">
                    ERP-style legal entity lookup with BidStack fallback.
                  </p>
                </div>
                <Badge
                  tone={
                    autocomplete.data?.source === 'external_erp'
                      ? 'jade'
                      : autocomplete.data?.source === 'mixed'
                        ? 'purple'
                        : 'amber'
                  }
                >
                  {autocomplete.data?.source ?? 'checking'}
                </Badge>
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="min-h-10 flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 text-sm text-[var(--fg-primary)] outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                  aria-label="Company autocomplete query"
                  placeholder="Name, domain, VAT, or DUNS"
                />
                <Button size="sm" variant="secondary" onClick={() => autocomplete.refetch()}>
                  Check
                </Button>
              </div>
            </div>
            {autocomplete.isLoading ? (
              <div className="p-3">
                <LoadingSkeleton rows={3} />
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)]">
                {autocomplete.data?.items.map((item) => (
                  <li key={item.id} className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-[var(--fg-primary)]">
                          {item.name}
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--fg-secondary)]">
                          {[
                            item.domain,
                            item.vat ? `VAT ${item.vat}` : null,
                            item.duns ? `DUNS ${item.duns}` : null,
                          ]
                            .filter(Boolean)
                            .join(' / ') || 'No registry keys yet'}
                        </div>
                      </div>
                      <Badge tone={item.source === 'external_erp' ? 'jade' : 'blue'}>
                        {Math.round(item.confidence * 100)}%
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.matchKeys.map((key) => (
                        <span
                          key={key}
                          className="rounded bg-[var(--surface-card)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--fg-tertiary)]"
                        >
                          {key}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
                {autocomplete.data?.items.length === 0 ? (
                  <li className="p-4 text-sm text-[var(--fg-secondary)]">
                    No company suggestions yet. Add ERP MCP credentials or verify this account in
                    BidStack.
                  </li>
                ) : null}
              </ul>
            )}
            {autocomplete.data?.warnings.length ? (
              <div className="border-t border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--fg-tertiary)]">
                {autocomplete.data.warnings[0]}
              </div>
            ) : null}
          </div>
        </div>
        {kit.data?.nextActions.length ? (
          <div className="mt-4 rounded-md bg-[var(--info-tint)] px-3 py-2 text-xs text-[var(--fg-secondary)]">
            {kit.data.nextActions[0]}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold tabular-nums text-[var(--fg-primary)]">
        {value}
      </div>
    </div>
  );
}

function hostOf(raw: string | null): string {
  if (!raw) return 'n/a';
  try {
    const u = new URL(raw);
    return u.host || raw;
  } catch {
    return raw;
  }
}

function looksLikeDomain(value: string) {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(value.trim().replace(/^https?:\/\//, ''));
}
