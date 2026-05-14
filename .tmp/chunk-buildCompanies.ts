function buildCompanies(
  opportunities: Array<{
    customer: string;
    industry: string | null;
    logoUrl: string | null;
    updatedAt: Date;
  }>,
  enrichments: CompanyEnrichment[],
) {
  const byName = new Map<string, z.infer<typeof CrmCompany>>();
  for (const enrichment of enrichments) {
    const company = serializeCompany(enrichment);
    byName.set(normalizeName(company.name), company);
  }

  for (const opportunity of opportunities) {
    const normalized = normalizeName(opportunity.customer);
    if (byName.has(normalized)) continue;
    byName.set(normalized, {
      id: normalized,
      source: 'twenty',
      name: opportunity.customer,
      legalName: opportunity.customer,
      domain: domainFor(opportunity.customer),
      website: websiteFor(opportunity.customer),
      industry: opportunity.industry,
      employeeCount: null,
      annualRevenueMicros: null,
      status: 'active',
      registryIds: {},
      formerNames: [],
      incorporationDate: null,
      imageUrl: null,
      logo: logoFor(opportunity.customer, opportunity.logoUrl),
      confidence: 0.55,
      sourceAttribution: [
        attribution({
          source: 'twenty',
          label: 'Twenty opportunity/customer record',
          sourceUrl: null,
          confidence: 0.55,
        }),
      ],
      updatedAt: opportunity.updatedAt.toISOString(),
    });
  }

  if (!byName.has('mantu')) byName.set('mantu', fallbackCompany('Mantu'));
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function findSelectedCompany(
  companies: Array<z.infer<typeof CrmCompany>>,
  accountId: string | undefined,
) {
  if (!accountId) return null;
  const normalized = normalizeName(accountId);
  return (
    companies.find((company) => company.id === accountId) ??
    companies.find((company) => normalizeName(company.name) === normalized) ??
    null
  );
}

function serializeCompany(enrichment: CompanyEnrichment): z.infer<typeof CrmCompany> {
  const name = enrichment.tradeName ?? enrichment.legalName;
  const metadata = record(enrichment.providerMetadata);
  const industryCodes = stringArray(enrichment.industryCodes);
  return {
    id: enrichment.id,
    source: 'enrichment',
    name,
    legalName: enrichment.legalName,
    domain: enrichment.domain,
    website: enrichment.website,
    industry: industryCodes[0] ?? null,
    imageUrl: stringUrl(metadata.companyImageUrl),
    employeeCount: enrichment.employeeCount,
    annualRevenueMicros:
      enrichment.annualRevenueMicros === null ? null : Number(enrichment.annualRevenueMicros),
    status: enrichment.status,
    registryIds: stringRecord(enrichment.registryIds),
    formerNames: stringArray(enrichment.formerNames),
    incorporationDate: enrichment.incorporationDate
      ? enrichment.incorporationDate.toISOString().slice(0, 10)
      : null,
    logo: logoFor(name, enrichment.logoUrl, enrichment.logoSource),
    technicalStack: parseTechnicalStack(metadata.meetingTechStack),
    confidence: enrichment.confidenceBps / 10_000,
    sourceAttribution: parseAttribution(enrichment.sourceAttribution),
    updatedAt: enrichment.updatedAt.toISOString(),
  };
}
