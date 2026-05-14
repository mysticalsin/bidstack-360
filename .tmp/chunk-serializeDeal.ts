function serializeDeal(opportunity: {
  id: string;
  customer: string;
  name: string;
  stage: PrismaStage;
  valueMicros: bigint | number | unknown;
  probability: number;
  dueDate: Date | null;
  ownerId: string | null;
  owner: { name: string | null; email: string } | null;
  updatedAt: Date;
}): z.infer<typeof CrmDeal> {
  return {
    id: opportunity.id,
    source: 'twenty',
    companyId: normalizeName(opportunity.customer),
    companyName: opportunity.customer,
    name: opportunity.name,
    stage: mapDealStage(opportunity.stage),
    amountMicros: Math.round(Number(opportunity.valueMicros ?? 0)),
    currencyCode: 'EUR',
    probability: opportunity.probability,
    closeDate: opportunity.dueDate ? opportunity.dueDate.toISOString().slice(0, 10) : null,
    ownerId: opportunity.ownerId,
    ownerName: opportunity.owner?.name ?? opportunity.owner?.email ?? null,
    updatedAt: opportunity.updatedAt.toISOString(),
  };
}

function buildActivities(
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    opportunity?: { id: string; customer: string; name: string } | null;
    assignee?: { name: string | null; email: string } | null;
    createdAt: Date;
  }>,
): Array<z.infer<typeof CrmActivity>> {
  return tasks.map((task) => ({
    id: task.id,
    source: 'twenty',
    subject: task.title,
    body: `Task is ${task.status.replace('_', ' ')}.`,
    kind: 'task',
    companyId: task.opportunity ? normalizeName(task.opportunity.customer) : null,
    dealId: task.opportunity?.id ?? null,
    personId: null,
    actorName: task.assignee?.name ?? task.assignee?.email ?? null,
    occurredAt: task.createdAt.toISOString(),
  }));
}

function buildDefaultInsights(
  opportunities: Array<{
    id: string;
    customer: string;
    name: string;
    probability: number;
    updatedAt: Date;
  }>,
): Array<z.infer<typeof AiInsight>> {
  const lowest = [...opportunities].sort((a, b) => a.probability - b.probability)[0];
  const largest = [...opportunities].sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))[0];
  return [
    {
      id: 'insight-stagnation',
      kind: 'deal_stagnation',
      title: 'Deal stagnation watch',
      summary: lowest
        ? `${lowest.customer} needs a next-step owner before the close plan ages out.`
        : 'No open opportunity risk detected.',
      confidence: 0.78,
      companyId: lowest ? normalizeName(lowest.customer) : null,
      companyName: lowest?.customer ?? null,
      dealId: lowest?.id ?? null,
      sourceAttribution: [
        attribution({
          source: 'bidstack_rules',
          label: 'Pipeline velocity model',
          sourceUrl: null,
          confidence: 0.78,
        }),
      ],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'insight-upsell',
      kind: 'funding_upsell',
      title: 'Funding and award upsell signal',
      summary: largest
        ? `${largest.customer} has enough active motion to justify a managed-security expansion play.`
        : 'No funding signal available yet.',
      confidence: 0.71,
      companyId: largest ? normalizeName(largest.customer) : null,
      companyName: largest?.customer ?? null,
      dealId: largest?.id ?? null,
      sourceAttribution: [
        attribution({
          source: 'verified_source_registry',
          label: 'SAM/TED/USAspending adapter registry',
          sourceUrl: null,
          confidence: 0.71,
        }),
      ],
      createdAt: new Date().toISOString(),
    },
  ];
}

function serializeWidget(widget: {
  id: string;
  kind: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: unknown;
}): z.infer<typeof DashboardWidget> {
  return {
    id: widget.id,
    kind: widget.kind as z.infer<typeof DashboardWidget>['kind'],
    title: widget.title,
    x: widget.x,
    y: widget.y,
    w: widget.w,
    h: widget.h,
    config: record(widget.config),
  };
}
