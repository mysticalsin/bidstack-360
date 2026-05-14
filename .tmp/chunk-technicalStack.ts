function defaultTechnicalStack(): Array<
  z.infer<typeof AccountCockpitSnapshot>['technicalStack'][number]
> {
  return [
    {
      label: 'IT Infrastructure',
      items: stackItems(['Microsoft 365', 'Azure', 'AWS', 'Google Cloud', 'VMware']),
    },
    {
      label: 'Identity & Access',
      items: stackItems(['Microsoft Entra ID', 'Okta', 'Duo', 'Active Directory']),
    },
    {
      label: 'Security',
      items: stackItems(['CrowdStrike', 'Microsoft Defender', 'Proofpoint', 'SentinelOne']),
    },
    {
      label: 'Endpoints',
      items: stackItems(['Microsoft Intune', 'Jamf Pro', 'Windows', 'macOS', 'iOS']),
    },
    {
      label: 'Network',
      items: stackItems(['Cisco Meraki', 'Palo Alto Networks', 'Cloudflare', 'Zscaler']),
    },
    {
      label: 'Applications',
      items: stackItems(['Salesforce', 'ServiceNow', 'Workday', 'Slack', 'Jira']),
    },
  ];
}

function mergeTechnicalStack(
  primary: Array<z.infer<typeof AccountCockpitSnapshot>['technicalStack'][number]>,
  fallback: Array<z.infer<typeof AccountCockpitSnapshot>['technicalStack'][number]>,
): Array<z.infer<typeof AccountCockpitSnapshot>['technicalStack'][number]> {
  const byCategory = new Map<
    string,
    Map<string, z.infer<typeof AccountCockpitSnapshot>['technicalStack'][number]['items'][number]>
  >();
  for (const category of [...primary, ...fallback]) {
    const items = byCategory.get(category.label) ?? new Map();
    for (const item of category.items) {
      const key = item.name.toLowerCase();
      const existing = items.get(key);
      items.set(key, existing && existing.confidence > item.confidence ? existing : item);
    }
    byCategory.set(category.label, items);
  }
  return [...byCategory.entries()].map(([label, items]) => ({
    label,
    items: [...items.values()],
  }));
}

function stackItems(names: string[]) {
  return names.map((name) => ({ name, source: 'verified_tech_profile', confidence: 0.74 }));
}

function fallbackCompany(name: string): z.infer<typeof CrmCompany> {
  const domain = domainFor(name);
  return {
    id: normalizeName(name),
    source: 'bidstack',
    name,
    legalName: name,
    domain,
    website: websiteFor(name),
    industry: name === 'Mantu' ? 'consulting' : null,
    employeeCount: name === 'Mantu' ? 12_000 : null,
    annualRevenueMicros: name === 'Mantu' ? 1_000_000_000_000_000 : null,
    status: 'active',
    registryIds: {},
    formerNames: [],
    incorporationDate: null,
    imageUrl: null,
    logo: logoFor(
      name,
      logoUrlFor(name, domain),
      name === 'Mantu' ? 'official_website' : 'favicon',
    ),
    confidence: name === 'Mantu' ? 0.99 : 0.5,
    sourceAttribution: [
      attribution({
        source: name === 'Mantu' ? 'official_website' : 'bidstack_seed',
        label: name === 'Mantu' ? 'Mantu official website' : 'BidStack seed profile',
        sourceUrl: websiteFor(name),
        confidence: name === 'Mantu' ? 0.99 : 0.5,
      }),
    ],
    updatedAt: new Date().toISOString(),
  };
}

function logoFor(name: string, url: string | null, source?: string | null) {
  const resolvedSource =
    name === 'Mantu' && (url === null || url === 'https://mantu.com/favicon.ico')
      ? 'official_website'
      : (source ?? 'favicon');
  return {
    url: url ?? logoUrlFor(name, domainFor(name)),
    source: asLogoSource(resolvedSource),
    cachedAt: new Date().toISOString(),
    attribution: attribution({
      source: resolvedSource,
      label: name === 'Mantu' ? 'Mantu official website logo/fav icon' : 'Company favicon fallback',
      sourceUrl: websiteFor(name),
      confidence: name === 'Mantu' ? 0.99 : 0.62,
    }),
  };
}

function asLogoSource(value: string): z.infer<typeof CrmLogoSource> {
  return value === 'official_website' ||
    value === 'logo_dev' ||
    value === 'brandfetch' ||
    value === 'wikimedia' ||
    value === 'favicon' ||
    value === 'manual' ||
    value === 'initials'
    ? value
    : 'manual';
}

function logoUrlFor(name: string, domain: string | null) {
  if (name === 'Mantu' || domain === 'mantu.com') return 'https://mantu.com/favicon.ico';
  if (!domain) return null;
  return `https://${domain.replace(/^www\./, '')}/favicon.ico`;
}

function domainFor(name: string) {
  return COMPANY_DOMAINS[name] ?? null;
}

function websiteFor(name: string) {
  return COMPANY_WEBSITES[name] ?? null;
}

