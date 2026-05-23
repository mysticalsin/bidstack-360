import { motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { useOpenDataSignals } from '@/hooks/useOpenDataSignals';
import { springSnap, springSoft } from '@/lib/motion';

import type { AccountCockpitSnapshot, CrmConnector, OpenDataSignal } from '@bidstack/shared';

import { tickerForCompany } from './_tokens';

interface Props {
  cockpit: AccountCockpitSnapshot;
}

export const LiveDataMeshCard = memo(function LiveDataMeshCard({ cockpit }: Props) {
  const reducedMotion = useReducedMotion();
  const ticker = tickerForCompany(cockpit.company.name);
  const liveData = useOpenDataSignals({
    query: cockpit.company.legalName ?? cockpit.company.name,
    ticker,
  });
  const connectors = liveData.data?.connectors ?? [];
  const usingFallbackConnectors = connectors.length === 0;
  const visibleConnectors = usingFallbackConnectors ? fallbackConnectors() : connectors;
  const signals = liveData.data?.signals ?? [];
  const openConnectors = visibleConnectors.filter((c) => c.kind === 'open_api').length;
  const enabledConnectors = usingFallbackConnectors
    ? 0
    : visibleConnectors.filter((c) => c.status === 'healthy').length;
  const availabilityLabel = usingFallbackConnectors
    ? `${visibleConnectors.length} available`
    : `${enabledConnectors}/${visibleConnectors.length} connected`;

  return (
    <Card role="region" aria-label="Connected data sources">
      <SectionHeader
        title={usingFallbackConnectors ? 'Available data sources' : 'Connected data sources'}
        caption={
          usingFallbackConnectors
            ? 'Sources available after credentials or connector setup'
            : 'Configured APIs, widgets, and verified data feeds'
        }
      />
      <div className="data-mesh">
        <div className="mesh-hero">
          <div>
            <div className="mesh-kicker">Source availability</div>
            <strong>{availabilityLabel}</strong>
          </div>
          <div className="mesh-stat">
            <span>{openConnectors}</span>
            <small>public sources</small>
          </div>
        </div>

        <div className="mesh-connectors" aria-label="Connector status">
          {visibleConnectors.slice(0, 6).map((connector, index) => (
            <ConnectorPill
              key={connector.id}
              connector={connector}
              index={index}
              reducedMotion={Boolean(reducedMotion)}
            />
          ))}
        </div>

        <div className="mesh-signals" aria-label="Available source signals">
          {liveData.isLoading ? (
            <div className="mesh-empty">Checking configured sources...</div>
          ) : liveData.isError ? (
            <div className="mesh-empty">
              Connector registry loaded; source check returned an error.
            </div>
          ) : signals.length === 0 ? (
            <div className="mesh-empty">No public signal returned for this account yet.</div>
          ) : (
            signals
              .slice(0, 3)
              .map((signal, index) => (
                <SignalRow
                  key={signal.id}
                  signal={signal}
                  index={index}
                  reducedMotion={Boolean(reducedMotion)}
                />
              ))
          )}
        </div>
      </div>
    </Card>
  );
});

function ConnectorPill({
  connector,
  index,
  reducedMotion,
}: {
  connector: CrmConnector;
  index: number;
  reducedMotion: boolean;
}) {
  return (
    <motion.a
      className="mesh-connector"
      href={connector.docsUrl}
      target="_blank"
      rel="noreferrer"
      aria-label={`${connector.name} is ${connector.status}`}
      title={connector.message ?? connector.name}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={reducedMotion ? undefined : { y: -2 }}
      whileTap={reducedMotion ? undefined : { scale: 0.98 }}
      transition={{ ...springSnap, delay: reducedMotion ? 0 : index * 0.035 }}
    >
      <span className={`mesh-status status-${connector.status}`} aria-hidden />
      <span>{connector.name}</span>
    </motion.a>
  );
}

function SignalRow({
  signal,
  index,
  reducedMotion,
}: {
  signal: OpenDataSignal;
  index: number;
  reducedMotion: boolean;
}) {
  const attribution = signal.sourceAttribution[0];
  const href = signal.url ?? attribution?.sourceUrl ?? undefined;
  return (
    <motion.a
      className="mesh-signal"
      href={href}
      target={href ? '_blank' : undefined}
      rel={href ? 'noreferrer' : undefined}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.04 }}
    >
      <div>
        <strong>{signal.title}</strong>
        <span>{signal.summary}</span>
      </div>
      <Badge tone={signal.confidence >= 0.9 ? 'jade' : 'blue'}>
        {Math.round(signal.confidence * 100)}%
      </Badge>
    </motion.a>
  );
}

// Connector fallbacks — used when the live /api/open-data endpoint returns
// no rows (typically because the user hasn't credentialed Apollo/SAM yet).
// Keeps the mesh visually populated with the open-data sources we publish.
function fallbackConnectors(): CrmConnector[] {
  const lastCheckedAt = new Date().toISOString();
  return [
    fallbackConnector('erp-sales', 'ERP', 'official_widget', 'company', lastCheckedAt),
    fallbackConnector(
      'external-crm-core',
      'External CRM',
      'official_widget',
      'company',
      lastCheckedAt,
    ),
    fallbackConnector('sec-edgar', 'SEC EDGAR', 'open_api', 'company', lastCheckedAt),
    fallbackConnector('usaspending', 'USAspending', 'open_api', 'procurement', lastCheckedAt),
    fallbackConnector(
      'tradingview-widgets',
      'TradingView',
      'official_widget',
      'market',
      lastCheckedAt,
    ),
    fallbackConnector(
      'apollo-organizations',
      'Apollo',
      'credentialed_api',
      'people',
      lastCheckedAt,
    ),
    fallbackConnector('sam-gov', 'SAM.gov', 'credentialed_api', 'procurement', lastCheckedAt),
    fallbackConnector('brandfetch', 'Brandfetch', 'credentialed_api', 'logo', lastCheckedAt),
  ];
}

function fallbackConnector(
  id: string,
  name: string,
  kind: CrmConnector['kind'],
  category: CrmConnector['category'],
  lastCheckedAt: string,
): CrmConnector {
  const docsUrl = fallbackConnectorDocs(id);
  return {
    id,
    name,
    category,
    kind,
    status: 'disabled',
    requiresCredential: kind === 'credentialed_api',
    sourceUrl: docsUrl,
    docsUrl,
    lastCheckedAt,
    message: null,
    capabilities: [],
  };
}

function fallbackConnectorDocs(id: string): string {
  if (id === 'erp-sales') return 'https://github.com/mysticalsin/bidstack';
  if (id === 'external-crm-core') return 'https://github.com/mysticalsin/bidstack';
  if (id === 'sec-edgar')
    return 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces';
  if (id === 'usaspending') return 'https://api.usaspending.gov/docs/';
  if (id === 'tradingview-widgets') return 'https://www.tradingview.com/widget-docs/';
  if (id === 'apollo-organizations')
    return 'https://docs.apollo.io/reference/organization-verification';
  if (id === 'sam-gov') return 'https://open.gsa.gov/api/get-opportunities-public-api/';
  return 'https://docs.brandfetch.com/docs/logo-link';
}
