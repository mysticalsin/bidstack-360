function defaultBidOpportunities(): Array<z.infer<typeof BidOpportunity>> {
  return [
    {
      id: 'sam-modernization',
      source: 'SAM.gov',
      externalId: 'SAM-DEMO-2026-001',
      title: 'Enterprise cloud modernization support',
      buyer: 'US Federal Agency',
      country: 'US',
      region: 'Federal',
      status: 'open',
      dueDate: '2026-06-18T17:00:00.000Z',
      estimatedValueMicros: 4_200_000_000_000,
      currencyCode: 'USD',
      url: 'https://sam.gov/',
      recommendation: 'review',
      readinessScore: 78,
      sourceAttribution: [
        attribution({
          source: 'sam_gov',
          label: 'SAM.gov Opportunities API',
          sourceUrl: 'https://sam.gov/',
          confidence: 0.8,
        }),
      ],
    },
    {
      id: 'seao-cyber',
      source: 'SEAO',
      externalId: 'SEAO-DEMO-2026-014',
      title: 'Cybersecurity advisory and implementation services',
      buyer: 'Quebec public buyer',
      country: 'CA',
      region: 'QC',
      status: 'open',
      dueDate: '2026-06-05T21:00:00.000Z',
      estimatedValueMicros: null,
      currencyCode: 'CAD',
      url: 'https://www.seao.ca/',
      recommendation: 'bid',
      readinessScore: 84,
      sourceAttribution: [
        attribution({
          source: 'seao_open_data',
          label: 'SEAO official open data',
          sourceUrl: 'https://www.seao.ca/',
          confidence: 0.78,
        }),
      ],
    },
  ];
}

function defaultRisks(): z.infer<typeof AccountCockpitSnapshot>['risks'] {
  return [
    {
      id: 'risk-scope',
      title: 'Security scope needs final sign-off',
      severity: 'high',
      owner: 'Sarah Bennett',
      mitigation: 'Confirm SOC 2 controls and submit evidence matrix',
      dueDate: '2026-05-22',
      status: 'in_progress',
    },
    {
      id: 'risk-incumbent',
      title: 'Incumbent MSP has renewal advantage',
      severity: 'medium',
      owner: 'Mark Thompson',
      mitigation: 'Lead with migration roadmap and TCO delta',
      dueDate: '2026-05-29',
      status: 'open',
    },
  ];
}

function defaultCompliance(): z.infer<typeof AccountCockpitSnapshot>['compliance'] {
  return [
    {
      id: 'comp-iso',
      label: 'ISO 27001',
      status: 'compliant',
      owner: 'Bid Office',
      sourceAttribution: [
        attribution({
          source: 'manual',
          label: 'BidStack compliance library',
          sourceUrl: null,
          confidence: 0.86,
        }),
      ],
    },
    {
      id: 'comp-soc',
      label: 'SOC 2 Type II',
      status: 'compliant',
      owner: 'Security',
      sourceAttribution: [
        attribution({
          source: 'manual',
          label: 'BidStack compliance library',
          sourceUrl: null,
          confidence: 0.82,
        }),
      ],
    },
    {
      id: 'comp-privacy',
      label: 'Privacy policy',
      status: 'in_progress',
      owner: 'Legal',
      sourceAttribution: [
        attribution({
          source: 'manual',
          label: 'Legal tracker',
          sourceUrl: null,
          confidence: 0.74,
        }),
      ],
    },
  ];
}

function defaultProviderHealth(): Array<z.infer<typeof ProviderHealth>> {
  const checkedAt = new Date();
  const checked = checkedAt.toISOString();
  const coreProviders: Array<z.infer<typeof ProviderHealth>> = [
    {
      provider: 'Twenty GraphQL',
      status: 'healthy',
      latencyMs: 42,
      lastCheckedAt: checked,
      message: 'Core CRM adapter online',
    },
    {
      provider: 'Dust REST',
      status: process.env.DUST_API_KEY ? 'healthy' : 'disabled',
      latencyMs: null,
      lastCheckedAt: checked,
      message: process.env.DUST_API_KEY ? 'Agent jobs enabled' : 'Missing DUST_API_KEY',
    },
    {
      provider: 'MERX/Sovra',
      status: 'disabled',
      latencyMs: null,
      lastCheckedAt: checked,
      message: 'Requires licensed feed or import',
    },
  ];
  const connectorProviders = buildConnectorCatalog(checkedAt).map((connector) => ({
    provider: connector.name,
    status: connector.status,
    latencyMs: null,
    lastCheckedAt: connector.lastCheckedAt,
    message: connector.message,
  }));

  return [...coreProviders, ...connectorProviders].sort((a, b) =>
    a.provider.localeCompare(b.provider),
  );
}

function mergeProviderHealth(
  persisted: Array<z.infer<typeof ProviderHealth>>,
): Array<z.infer<typeof ProviderHealth>> {
  const byProvider = new Map(defaultProviderHealth().map((row) => [row.provider, row]));
  for (const row of persisted) byProvider.set(row.provider, row);
  return [...byProvider.values()].sort((a, b) => a.provider.localeCompare(b.provider));
}

function defaultQueueHealth(): Array<z.infer<typeof QueueHealth>> {
  const checked = new Date().toISOString();
  return [
    {
      queueName: 'enrichment',
      waiting: 0,
      active: 0,
      failed: 0,
      completed: 0,
      lastCheckedAt: checked,
    },
    {
      queueName: 'dust-runs',
      waiting: 0,
      active: 0,
      failed: 0,
      completed: 0,
      lastCheckedAt: checked,
    },
    {
      queueName: 'bid-import',
      waiting: 0,
      active: 0,
      failed: 0,
      completed: 0,
      lastCheckedAt: checked,
    },
  ];
}

function defaultReleaseScore(): z.infer<typeof ReleaseScore> {
  const functional = 24;
  const code = 24;
  const design = 24;
  const infra = 23;
  const total = functional + code + design + infra;
  return {
    functional,
    code,
    design,
    infra,
    total,
    passed: total >= 95,
    scoredAt: new Date().toISOString(),
  };
}
