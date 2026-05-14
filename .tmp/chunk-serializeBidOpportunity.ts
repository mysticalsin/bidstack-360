function serializeBidOpportunity(row: {
  id: string;
  source: string;
  externalId: string;
  title: string;
  buyer: string | null;
  country: string | null;
  region: string | null;
  status: string;
  dueDate: Date | null;
  estimatedValueMicros: bigint | null;
  currencyCode: string | null;
  url: string | null;
  recommendation: string | null;
  readinessScore: number | null;
  sourceAttribution: unknown;
}): z.infer<typeof BidOpportunity> {
  return {
    id: row.id,
    source: row.source,
    externalId: row.externalId,
    title: row.title,
    buyer: row.buyer,
    country: row.country,
    region: row.region,
    status: row.status,
    dueDate: row.dueDate?.toISOString() ?? null,
    estimatedValueMicros:
      row.estimatedValueMicros === null ? null : Number(row.estimatedValueMicros),
    currencyCode: row.currencyCode,
    url: row.url,
    recommendation: row.recommendation as z.infer<typeof BidOpportunity>['recommendation'],
    readinessScore: row.readinessScore,
    sourceAttribution: parseAttribution(row.sourceAttribution),
  };
}

function serializeRisk(
  row: PrismaRiskRegisterItem,
): z.infer<typeof AccountCockpitSnapshot>['risks'][number] {
  return {
    id: row.id,
    title: row.title,
    severity: asRiskSeverity(row.severity),
    owner: row.owner,
    mitigation: row.mitigation,
    dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
    status: asRiskStatus(row.status),
  };
}

function serializeCompliance(
  row: PrismaComplianceCheck,
): z.infer<typeof AccountCockpitSnapshot>['compliance'][number] {
  return {
    id: row.id,
    label: row.label,
    status: asComplianceStatus(row.status),
    owner: row.owner,
    sourceAttribution: parseAttribution(row.sourceAttribution),
  };
}

function serializeProviderHealth(row: PrismaProviderHealth): z.infer<typeof ProviderHealth> {
  return {
    provider: row.provider,
    status: asProviderStatus(row.status),
    latencyMs: row.latencyMs,
    lastCheckedAt: row.lastCheckedAt.toISOString(),
    message: row.message,
  };
}

function serializeQueueHealth(row: PrismaQueueHealth): QueueHealth {
  return {
    queueName: row.queueName,
    waiting: row.waiting,
    active: row.active,
    failed: row.failed,
    completed: row.completed,
    lastCheckedAt: row.lastCheckedAt.toISOString(),
  };
}

function serializeReleaseScore(row: PrismaReleaseScore): z.infer<typeof ReleaseScore> {
  const total = row.functional + row.code + row.design + row.infra;
  return {
    functional: row.functional,
    code: row.code,
    design: row.design,
    infra: row.infra,
    total,
    passed: total >= 95,
    scoredAt: row.scoredAt.toISOString(),
  };
}
