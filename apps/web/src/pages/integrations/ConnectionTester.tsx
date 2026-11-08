/**
 * integrations/ConnectionTester.tsx — endpoint probe UI for the Integrations
 * overview tab.
 *
 * WHY a separate module: ConnectionTester is ~154 lines of stateful probe logic.
 * Extracting it lets ConnectionCommandCenter and the overview tab remain
 * layout-focused while this component owns the probe lifecycle end-to-end.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { toast } from '@/components/ui/Toast';
import { api } from '@/lib/api';

import { ProbeHint, ProbeResultCard } from './IntegrationAtoms';
import { defaultProbeUrl, safeUrlPreview } from './integration-helpers';
import type { IntegrationProbeResult, IntegrationSetupGuide, ProbeKind } from './types';

// ─── Probe options catalogue ────────────────────────────────────────────────────

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

// Stable i18n key suffix per probe kind; the English source lives in PROBE_OPTIONS
// and is passed as the t() default so the UI never shows a raw key.
const PROBE_OPTION_LABEL_KEY: Record<ProbeKind, string> = {
  mcp: 'connectionTester.probeOption.mcp.label',
  rest: 'connectionTester.probeOption.rest.label',
  webhook: 'connectionTester.probeOption.webhook.label',
};
const PROBE_OPTION_DESCRIPTION_KEY: Record<ProbeKind, string> = {
  mcp: 'connectionTester.probeOption.mcp.description',
  rest: 'connectionTester.probeOption.rest.description',
  webhook: 'connectionTester.probeOption.webhook.description',
};

// ─── ConnectionTester ──────────────────────────────────────────────────────────

export function ConnectionTester({
  guide,
  isLoading,
}: {
  guide?: IntegrationSetupGuide;
  isLoading: boolean;
}) {
  const { t } = useTranslation('integrations');
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
      toast.error(t('connectionTester.toast.missingUrl', 'Add an endpoint URL first'));
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
        toast.success(t('connectionTester.toast.reachedTitle', 'Endpoint reached'), {
          description: response.message,
        });
      } else {
        toast.error(
          t('connectionTester.toast.warningTitle', 'Probe completed with a warning'),
          { description: response.message },
        );
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('connectionTester.toast.probeFailed', 'Endpoint probe failed.');
      setResult({
        ok: false,
        status: null,
        latencyMs: 0,
        checkedUrl: safeUrlPreview(nextUrl),
        message,
        warnings: [],
      });
      toast.error(t('connectionTester.toast.blockedTitle', 'Probe blocked'), {
        description: message,
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Card>
      <SectionHeader
        title={t('connectionTester.title', 'Connection tester')}
        caption={t(
          'connectionTester.caption',
          'Probe an endpoint from the API service before saving it. Secrets and bearer tokens are never sent.',
        )}
        action={
          <Badge tone={result?.ok ? 'jade' : result ? 'amber' : 'gray'}>
            {result?.ok
              ? t('connectionTester.status.reachable', 'reachable')
              : result
                ? t('connectionTester.status.needsAttention', 'needs attention')
                : t('connectionTester.status.ready', 'ready to test')}
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
                  {t(PROBE_OPTION_LABEL_KEY[option.key], option.label)}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--fg-secondary)]">
                  {t(PROBE_OPTION_DESCRIPTION_KEY[option.key], option.description)}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
              {t('connectionTester.endpointUrlLabel', 'Endpoint URL')}
            </span>
            <div className="flex flex-col gap-2 lg:flex-row">
              <input
                value={resolvedUrl}
                onChange={(event) => {
                  setUrlInput(event.target.value);
                  setResult(null);
                }}
                placeholder={
                  isLoading
                    ? t('connectionTester.placeholder.loading', 'Loading setup contract...')
                    : 'https://api.example.com/mcp'
                }
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
                  {t('connectionTester.useDefault', 'Use default')}
                </Button>
                <Button
                  type="button"
                  onClick={runProbe}
                  disabled={isTesting || !resolvedUrl.trim()}
                >
                  <Icon name={isTesting ? 'clock' : 'shield'} size={15} />
                  {isTesting
                    ? t('connectionTester.testing', 'Testing...')
                    : t('connectionTester.testEndpoint', 'Test endpoint')}
                </Button>
              </div>
            </div>
          </label>

          <div className="grid gap-3 lg:grid-cols-3">
            <ProbeHint
              icon="shield"
              title={t('connectionTester.hint.noSecrets.title', 'No secrets sent')}
              body={t(
                'connectionTester.hint.noSecrets.body',
                'The API probes reachability only. It strips query strings, fragments, usernames, and passwords.',
              )}
            />
            <ProbeHint
              icon="warning"
              title={t('connectionTester.hint.ssrf.title', 'SSRF guarded')}
              body={t(
                'connectionTester.hint.ssrf.body',
                'Private networks and internal hosts are blocked outside local development before any request is made.',
              )}
            />
            <ProbeHint
              icon="clock"
              title={t('connectionTester.hint.timeout.title', 'Fast timeout')}
              body={t(
                'connectionTester.hint.timeout.body',
                'The probe stops after 5 seconds and records a scoped audit event for administrator traceability.',
              )}
            />
          </div>

          {result ? <ProbeResultCard result={result} /> : null}
        </div>
      </div>
    </Card>
  );
}
