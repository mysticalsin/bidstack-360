function buildDataQualityReport(
  snapshot: z.infer<typeof CrmDashboardSnapshot>,
): z.infer<typeof DataQualityReport> {
  const issues: z.infer<typeof DataQualityReport>['issues'] = [];
  const byDomain = new Map<string, Array<z.infer<typeof CrmCompany>>>();
  const now = Date.now();

  for (const company of snapshot.companies) {
    if (company.domain) {
      const domain = normalizeDomain(company.domain);
      if (domain) byDomain.set(domain, [...(byDomain.get(domain) ?? []), company]);
      if (domain && !isValidDomain(domain)) {
        issues.push({
          id: `invalid-domain:${company.id}`,
          kind: 'invalid_domain',
          severity: 'medium',
          title: `${company.name} has an invalid domain`,
          detail: company.domain,
          companyId: company.id,
          companyName: company.name,
          sourceAttribution: company.sourceAttribution,
        });
      }
    }

    const latestFetch = latestAttributionDate(company.sourceAttribution);
    if (latestFetch && now - latestFetch.getTime() > 90 * 24 * 60 * 60 * 1000) {
      issues.push({
        id: `stale-enrichment:${company.id}`,
        kind: 'stale_enrichment',
        severity: 'low',
        title: `${company.name} enrichment is older than 90 days`,
        detail: `Last verified ${latestFetch.toISOString().slice(0, 10)}`,
        companyId: company.id,
        companyName: company.name,
        sourceAttribution: company.sourceAttribution,
      });
    }

    if (!company.logo?.url) {
      issues.push({
        id: `missing-logo:${company.id}`,
        kind: 'missing_logo',
        severity: 'low',
        title: `${company.name} is using initials fallback`,
        detail: 'No logo URL is cached for this account.',
        companyId: company.id,
        companyName: company.name,
        sourceAttribution: company.sourceAttribution,
      });
    }
  }

  for (const [domain, companies] of byDomain) {
    if (companies.length < 2) continue;
    issues.push({
      id: `duplicate-domain:${domain}`,
      kind: 'duplicate_company',
      severity: 'high',
      title: `${companies.length} companies share ${domain}`,
      detail: companies.map((company) => company.name).join(', '),
      companyId: companies[0]?.id ?? null,
      companyName: companies[0]?.name ?? null,
      sourceAttribution: [],
    });
  }

  for (const deal of snapshot.deals) {
    if (deal.ownerId) continue;
    issues.push({
      id: `missing-owner:${deal.id}`,
      kind: 'missing_owner',
      severity: 'medium',
      title: `${deal.name} has no owner`,
      detail: 'Assign an owner so reminders, audit, and forecast accountability work.',
      companyId: deal.companyId,
      companyName: deal.companyName,
      sourceAttribution: [],
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    counts: issues.reduce<Record<string, number>>((acc, issue) => {
      acc[issue.kind] = (acc[issue.kind] ?? 0) + 1;
      return acc;
    }, {}),
    issues,
  };
}

function latestAttributionDate(items: SourceAttributionType[]) {
  const times = items
    .map((item) => new Date(item.fetchedAt))
    .filter((date) => Number.isFinite(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  return times[0] ?? null;
}

function isValidDomain(domain: string) {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain);
}

function mapDealStage(stage: PrismaStage): z.infer<typeof CrmDeal>['stage'] {
  switch (stage) {
    case 'discovery':
      return 'new';
    case 'qualified':
      return 'screening';
    case 'negotiation':
      return 'meeting';
    default:
      return stage;
  }
}

function attribution({
  source,
  label,
  sourceUrl,
  confidence,
}: {
  source: string;
  label: string;
  sourceUrl: string | null;
  confidence: number;
}): SourceAttributionType {
  return {
    source,
    label,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    confidence,
    providerMetadata: {},
  };
}

function parseAttribution(value: unknown): SourceAttributionType[] {
  const parsed = z.array(SourceAttribution).safeParse(value);
  return parsed.success ? parsed.data : [];
}
