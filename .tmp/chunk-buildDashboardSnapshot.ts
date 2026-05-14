async function buildDashboardSnapshot(
  orgId: string,
  accountId?: string,
): Promise<z.infer<typeof CrmDashboardSnapshot>> {
  const [
    opportunities,
    contacts,
    tasks,
    enrichments,
    persistedInsights,
    widgets,
    bidRows,
    riskRows,
    complianceRows,
    providerRows,
    queueRows,
    releaseScoreRow,
  ] = await Promise.all([
    prisma.opportunity.findMany({
      where: { orgId },
      include: { owner: true },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
    prisma.contact.findMany({ where: { orgId }, orderBy: { name: 'asc' }, take: 200 }),
    prisma.task.findMany({
      where: { orgId },
      include: { opportunity: true, assignee: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.companyEnrichment.findMany({
      where: { orgId },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    }),
    prisma.aiInsight.findMany({
      where: { orgId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    prisma.dashboardWidget.findMany({
      where: { orgId },
      orderBy: [{ y: 'asc' }, { x: 'asc' }],
      take: 20,
    }),
    prisma.bidOpportunity.findMany({
      where: { orgId },
      orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
      take: 50,
    }),
    prisma.riskRegisterItem.findMany({
      where: { orgId },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: 50,
    }),
    prisma.complianceCheck.findMany({
      where: { orgId },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: 50,
    }),
    prisma.providerHealth.findMany({ where: { orgId }, orderBy: { provider: 'asc' } }),
    prisma.queueHealth.findMany({ where: { orgId }, orderBy: { queueName: 'asc' } }),
    prisma.releaseScore.findFirst({ where: { orgId }, orderBy: { scoredAt: 'desc' } }),
  ]);

  const companies = buildCompanies(opportunities, enrichments);
  const deals = opportunities.map((opportunity) => serializeDeal(opportunity));
  const activities = buildActivities(tasks);
  const insights = persistedInsights.length
    ? persistedInsights.map((insight) => ({
        id: insight.id,
        kind: insight.kind as z.infer<typeof AiInsight>['kind'],
        title: insight.title,
        summary: insight.summary,
        confidence: insight.confidenceBps / 10_000,
        companyId: insight.companyName ? normalizeName(insight.companyName) : null,
        companyName: insight.companyName,
        dealId: insight.opportunityId,
        sourceAttribution: parseAttribution(insight.sourceAttribution),
        createdAt: insight.createdAt.toISOString(),
      }))
    : buildDefaultInsights(opportunities);
  const dashboardWidgets = widgets.length ? widgets.map(serializeWidget) : DEFAULT_WIDGETS;
  const selectedCompany =
    findSelectedCompany(companies, accountId) ??
    companies.find((company) => company.name === 'CI Financial') ??
    companies.find((company) => company.name === 'Mantu') ??
    companies[0] ??
    fallbackCompany('Mantu');

  return {
    generatedAt: new Date().toISOString(),
    cockpit: buildCockpit({
      company: selectedCompany,
      companies,
      opportunities,
      contacts,
      tasks,
      risks: riskRows,
      compliance: complianceRows,
    }),
    companies,
    deals,
    activities,
    insights,
    widgets: dashboardWidgets,
    bidOpportunities: bidRows.length
      ? bidRows.map(serializeBidOpportunity)
      : defaultBidOpportunities(),
    providerHealth: providerRows.length
      ? mergeProviderHealth(providerRows.map(serializeProviderHealth))
      : defaultProviderHealth(),
    queueHealth: queueRows.length ? queueRows.map(serializeQueueHealth) : defaultQueueHealth(),
    releaseScore: releaseScoreRow ? serializeReleaseScore(releaseScoreRow) : defaultReleaseScore(),
  };
}
