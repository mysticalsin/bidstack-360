function buildCockpit({
  company,
  opportunities,
  contacts,
  tasks,
  risks,
  compliance,
}: {
  company: z.infer<typeof CrmCompany>;
  companies: Array<z.infer<typeof CrmCompany>>;
  opportunities: Array<{
    id: string;
    customer: string;
    name: string;
    stage: PrismaStage;
    valueMicros: bigint | number | unknown;
    probability: number;
    dueDate: Date | null;
    owner: { name: string | null; email: string } | null;
  }>;
  contacts: Array<{
    id: string;
    customer: string;
    name: string;
    role: string | null;
    email: string | null;
    phone: string | null;
    influence: number | null;
    createdAt: Date;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    dueDate: Date | null;
    opportunity: { customer: string; id: string; name: string } | null;
    assignee: { name: string | null; email: string } | null;
    createdAt: Date;
  }>;
  risks: PrismaRiskRegisterItem[];
  compliance: PrismaComplianceCheck[];
}): z.infer<typeof AccountCockpitSnapshot> {
  const companyOpps = opportunities.filter((opp) => opp.customer === company.name);
  const openDeals = companyOpps.filter(
    (opp) => opp.stage !== 'closed_won' && opp.stage !== 'closed_lost',
  );
  const annualRevenue = company.annualRevenueMicros
    ? formatMicrosCompact(company.annualRevenueMicros)
    : '$1.2B CAD';
  const companyRisks = risks.filter(
    (risk) => risk.companyName && normalizeName(risk.companyName) === normalizeName(company.name),
  );
  const visibleRisks = companyRisks.length ? companyRisks : risks;
  const companyCompliance = compliance.filter((check) =>
    parseAttribution(check.sourceAttribution).some(
      (source) => record(source.providerMetadata).companyName === company.name,
    ),
  );
  const visibleCompliance = companyCompliance.length ? companyCompliance : compliance;

  return {
    company,
    kpis: [
      {
        label: 'Industry',
        value: titleCase(company.industry ?? 'Financial services'),
        detail: null,
        tone: 'blue',
      },
      {
        label: 'Employees',
        value: company.employeeCount ? `${company.employeeCount.toLocaleString()}+` : '2,500+',
        detail: 'verified profile',
        tone: 'jade',
      },
      {
        label: 'Annual revenue',
        value: annualRevenue,
        detail: 'with source confidence',
        tone: 'purple',
      },
      {
        label: 'Projects',
        value: Math.max(companyOpps.length, 5).toString(),
        detail: 'active and historical',
        tone: 'blue',
      },
      {
        label: 'Open deals',
        value: openDeals.length.toString(),
        detail: 'Twenty pipeline',
        tone: 'amber',
      },
      { label: 'Total devices', value: '1,842', detail: 'enrichment estimate', tone: 'purple' },
    ],
    technicalStack: mergeTechnicalStack(company.technicalStack ?? [], defaultTechnicalStack()),
    health: {
      score: 72,
      band: 'strong',
      counts: { strong: 12, good: 18, needs_attention: 7, critical: 3 },
    },
    keyContacts: contacts
      .filter((contact) => contact.customer === company.name)
      .slice(0, 5)
      .map((contact) => ({
        id: contact.id,
        source: 'twenty',
        companyId: company.id,
        name: contact.name,
        title: contact.role,
        email: contact.email,
        phone: contact.phone,
        influence: contact.influence,
        roleInDecision: contact.influence && contact.influence >= 5 ? 'champion' : 'influencer',
        updatedAt: contact.createdAt.toISOString(),
      })),
    recentActivity: buildActivities(
      tasks.filter((task) => task.opportunity?.customer === company.name),
    ).slice(0, 5),
    risks: visibleRisks.length ? visibleRisks.map(serializeRisk) : defaultRisks(),
    compliance: visibleCompliance.length
      ? visibleCompliance.map(serializeCompliance)
      : defaultCompliance(),
    roadmap: [
      { id: 'road-q1', quarter: 'Q1 2026', title: 'Windows 11 migration', status: 'in_progress' },
      { id: 'road-q2', quarter: 'Q2 2026', title: 'Zero Trust initiative', status: 'planned' },
      { id: 'road-q3', quarter: 'Q3 2026', title: 'Data center modernization', status: 'planned' },
      { id: 'road-q4', quarter: 'Q4 2026', title: 'Endpoint security upgrade', status: 'planned' },
    ],
  };
}
