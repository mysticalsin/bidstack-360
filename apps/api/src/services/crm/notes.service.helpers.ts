// Meeting-notes extraction helpers: types, dictionaries, text-parsing utilities,
// and the full extractMeetingNotes pipeline.
// Persistence logic lives in notes.service.ts which imports from here.

import type {
  MeetingImportedContact,
  MeetingImportedTask,
  ComplianceCheck,
  RiskItem,
  SourceAttribution as SourceAttributionType,
  TechnicalStackCategory,
  TechnicalStackItemType,
} from '@bidstack/shared';

export type MeetingExtract = {
  techStack: TechnicalStackCategory[];
  contacts: MeetingImportedContact[];
  risks: RiskItem[];
  compliance: ComplianceCheck[];
  tasks: MeetingImportedTask[];
  sourceAttribution: SourceAttributionType[];
};

export const STACK_DICTIONARY: Array<{
  category: string;
  name: string;
  aliases: string[];
}> = [
  {
    category: 'IT Infrastructure',
    name: 'Microsoft 365',
    aliases: ['microsoft 365', 'office 365', 'm365'],
  },
  { category: 'IT Infrastructure', name: 'Azure', aliases: ['azure', 'microsoft azure'] },
  { category: 'IT Infrastructure', name: 'AWS', aliases: ['aws', 'amazon web services'] },
  { category: 'IT Infrastructure', name: 'Google Cloud', aliases: ['google cloud', 'gcp'] },
  { category: 'IT Infrastructure', name: 'VMware', aliases: ['vmware', 'vsphere'] },
  { category: 'IT Infrastructure', name: 'Snowflake', aliases: ['snowflake'] },
  { category: 'IT Infrastructure', name: 'Databricks', aliases: ['databricks'] },
  {
    category: 'Identity & Access',
    name: 'Microsoft Entra ID',
    aliases: ['entra id', 'azure ad', 'microsoft entra'],
  },
  { category: 'Identity & Access', name: 'Okta', aliases: ['okta'] },
  { category: 'Identity & Access', name: 'Duo', aliases: ['duo', 'duo security'] },
  {
    category: 'Identity & Access',
    name: 'Active Directory',
    aliases: ['active directory', 'ad ds'],
  },
  { category: 'Security', name: 'CrowdStrike', aliases: ['crowdstrike', 'crowd strike'] },
  {
    category: 'Security',
    name: 'Microsoft Defender',
    aliases: ['microsoft defender', 'defender for endpoint'],
  },
  { category: 'Security', name: 'Proofpoint', aliases: ['proofpoint'] },
  { category: 'Security', name: 'SentinelOne', aliases: ['sentinelone', 'sentinel one'] },
  { category: 'Security', name: 'Wiz', aliases: ['wiz'] },
  { category: 'Security', name: 'Snyk', aliases: ['snyk'] },
  { category: 'Endpoints', name: 'Microsoft Intune', aliases: ['intune', 'microsoft intune'] },
  { category: 'Endpoints', name: 'Jamf Pro', aliases: ['jamf pro', 'jamf'] },
  {
    category: 'Endpoints',
    name: 'Windows',
    aliases: ['windows 11', 'windows 10', 'windows endpoints'],
  },
  { category: 'Endpoints', name: 'macOS', aliases: ['macos', 'mac os', 'mac endpoints'] },
  { category: 'Endpoints', name: 'iOS', aliases: ['ios', 'ipad', 'iphone'] },
  { category: 'Network', name: 'Cisco Meraki', aliases: ['cisco meraki', 'meraki'] },
  { category: 'Network', name: 'Palo Alto Networks', aliases: ['palo alto', 'palo alto networks'] },
  { category: 'Network', name: 'Cloudflare', aliases: ['cloudflare'] },
  { category: 'Network', name: 'Zscaler', aliases: ['zscaler'] },
  { category: 'Applications', name: 'Salesforce', aliases: ['salesforce', 'sales cloud'] },
  { category: 'Applications', name: 'ServiceNow', aliases: ['servicenow', 'service now'] },
  { category: 'Applications', name: 'Workday', aliases: ['workday'] },
  { category: 'Applications', name: 'Slack', aliases: ['slack'] },
  { category: 'Applications', name: 'Jira', aliases: ['jira', 'atlassian jira'] },
  { category: 'Applications', name: 'HubSpot', aliases: ['hubspot', 'hub spot'] },
  { category: 'Applications', name: 'ERP', aliases: ['erp'] },
  { category: 'Applications', name: 'External CRM', aliases: ['external crm'] },
  { category: 'Applications', name: 'Apollo', aliases: ['apollo.io', 'apollo'] },
  { category: 'Applications', name: 'Dust', aliases: ['dust.tt', 'dust'] },
];

export const COMPLIANCE_DICTIONARY: Array<{ label: string; aliases: string[] }> = [
  { label: 'ISO 27001', aliases: ['iso 27001', 'iso27001'] },
  { label: 'SOC 2', aliases: ['soc 2', 'soc2'] },
  { label: 'GDPR', aliases: ['gdpr'] },
  { label: 'PCI DSS', aliases: ['pci dss', 'pci-dss'] },
  { label: 'HIPAA', aliases: ['hipaa'] },
  { label: 'PIPEDA', aliases: ['pipeda'] },
  { label: 'DPA', aliases: ['dpa', 'data processing agreement'] },
  { label: 'NDA', aliases: ['nda', 'non-disclosure'] },
];

export function extractMeetingNotes(
  bodyMd: string,
  companyName: string,
  source: SourceAttributionType,
): MeetingExtract {
  return {
    techStack: extractTechStack(bodyMd),
    contacts: extractContacts(bodyMd),
    risks: extractRisks(bodyMd),
    compliance: extractCompliance(bodyMd, companyName, source),
    tasks: extractTasks(bodyMd),
    sourceAttribution: [source],
  };
}

function extractTechStack(bodyMd: string): TechnicalStackCategory[] {
  const lower = bodyMd.toLowerCase();
  const byCategory = new Map<string, Map<string, TechnicalStackItemType>>();

  for (const candidate of STACK_DICTIONARY) {
    if (!candidate.aliases.some((alias) => containsAlias(lower, alias))) continue;
    const category = byCategory.get(candidate.category) ?? new Map();
    category.set(candidate.name.toLowerCase(), {
      name: candidate.name,
      source: 'meeting_notes_import',
      confidence: 0.86,
    });
    byCategory.set(candidate.category, category);
  }

  return [...byCategory.entries()].map(([label, items]) => ({
    label,
    items: [...items.values()].sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

function extractContacts(bodyMd: string): MeetingImportedContact[] {
  const chunks = bodyMd
    .split(/[\n;]+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const byEmailOrName = new Map<string, MeetingImportedContact>();

  for (const chunk of chunks) {
    const emails = [...chunk.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((match) =>
      match[0].toLowerCase(),
    );
    const phone = chunk.match(/(?:\+?\d[\d ().-]{7,}\d)/)?.[0] ?? null;
    if (!emails.length && !/\b(contact|attendee|buyer|champion|blocker|owner)\b/i.test(chunk)) {
      continue;
    }

    const email = emails[0] ?? null;
    const beforeEmail = email ? chunk.slice(0, chunk.toLowerCase().indexOf(email)).trim() : chunk;
    const cleaned = beforeEmail
      .replace(/^(contact|attendee|buyer|champion|blocker|owner|influencer)\s*[:=-]\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    const [namePart, titlePart] = cleaned.split(/\s[-|,]\s/, 2);
    const name = titleCaseName(
      namePart || (email ? (email.split('@')[0] ?? 'Unknown contact') : 'Unknown contact'),
    );
    const title = titlePart?.trim() || roleLabelFromText(chunk);
    const contact: MeetingImportedContact = {
      name,
      title: title || null,
      email,
      phone,
      roleInDecision: roleFromText(chunk),
      confidence: email ? 0.86 : 0.62,
    };
    byEmailOrName.set(email ?? name.toLowerCase(), contact);
  }

  return [...byEmailOrName.values()].slice(0, 20);
}

function extractRisks(bodyMd: string): RiskItem[] {
  const lines = bodyMd
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /risk|concern|blocker|issue|challenge|delay|security|compliance/i.test(line));
  const seen = new Set<string>();
  const risks: RiskItem[] = [];

  for (const line of lines) {
    const title = line
      .replace(/^[-*]\s*/, '')
      .replace(/^(risk|concern|blocker|issue|challenge)\s*[:=-]\s*/i, '')
      .trim()
      .slice(0, 180);
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    risks.push({
      id: `meeting-risk-${risks.length + 1}`,
      title,
      severity: severityFromText(line),
      owner: ownerFromText(line),
      mitigation: mitigationFromText(line),
      dueDate: dateFromText(line),
      status: /accepted|approved/i.test(line)
        ? 'accepted'
        : /mitigated|resolved|closed/i.test(line)
          ? 'mitigated'
          : /progress|working|investigating/i.test(line)
            ? 'in_progress'
            : 'open',
    });
  }

  return risks.slice(0, 12);
}

function extractCompliance(
  bodyMd: string,
  companyName: string,
  source: SourceAttributionType,
): ComplianceCheck[] {
  const lower = bodyMd.toLowerCase();
  const checks: ComplianceCheck[] = [];

  for (const item of COMPLIANCE_DICTIONARY) {
    const matchingLine = bodyMd
      .split('\n')
      .find((line) => item.aliases.some((alias) => line.toLowerCase().includes(alias)));
    if (!item.aliases.some((alias) => lower.includes(alias))) continue;
    checks.push({
      id: `meeting-compliance-${slug(item.label)}`,
      label: item.label,
      status: complianceStatusFromText(matchingLine ?? bodyMd),
      owner: ownerFromText(matchingLine ?? bodyMd),
      sourceAttribution: [
        {
          ...source,
          providerMetadata: {
            ...source.providerMetadata,
            companyName,
            complianceLabel: item.label,
          },
        },
      ],
    });
  }

  return checks;
}

function extractTasks(bodyMd: string): MeetingImportedTask[] {
  const tasks: MeetingImportedTask[] = [];
  const seen = new Set<string>();

  for (const rawLine of bodyMd.split('\n')) {
    const line = rawLine.trim();
    if (!/^(action|next|todo|follow[- ]?up|owner)\b/i.test(line)) continue;
    const title = line
      .replace(/^[-*]\s*/, '')
      .replace(/^(action|next|todo|follow[- ]?up|owner)\s*[:=-]\s*/i, '')
      .trim()
      .slice(0, 255);
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    tasks.push({
      title,
      dueDate: dateFromText(line),
      status: /done|complete|completed/i.test(line)
        ? 'done'
        : /blocked|waiting/i.test(line)
          ? 'blocked'
          : /progress|working/i.test(line)
            ? 'in_progress'
            : 'open',
      confidence: 0.82,
    });
  }

  return tasks.slice(0, 20);
}

// ─── Text-parsing utilities (extraction only) ─────────────────────────────

function containsAlias(lowerText: string, rawAlias: string): boolean {
  const alias = rawAlias.toLowerCase();
  if (alias.length <= 3 && /^[a-z0-9]+$/.test(alias)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegex(alias)}([^a-z0-9]|$)`, 'i').test(lowerText);
  }
  return lowerText.includes(alias);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function severityFromText(value: string): RiskItem['severity'] {
  if (/critical|urgent|blocker|sev\s*1/i.test(value)) return 'critical';
  if (/high|major|red/i.test(value)) return 'high';
  if (/low|minor|watch/i.test(value)) return 'low';
  return 'medium';
}

function complianceStatusFromText(value: string): ComplianceCheck['status'] {
  if (/blocked|missing|failed|gap/i.test(value)) return 'blocked';
  if (/progress|review|pending|in flight|working/i.test(value)) return 'in_progress';
  if (/compliant|complete|completed|certified|approved|done/i.test(value)) return 'compliant';
  return 'not_started';
}

function roleFromText(value: string): MeetingImportedContact['roleInDecision'] {
  if (/champion/i.test(value)) return 'champion';
  if (/blocker/i.test(value)) return 'blocker';
  if (/buyer|procurement|economic/i.test(value)) return 'buyer';
  if (/user|technical/i.test(value)) return 'user';
  if (/influencer|stakeholder|owner/i.test(value)) return 'influencer';
  return null;
}

function roleLabelFromText(value: string): string | null {
  const role = roleFromText(value);
  if (!role) return null;
  return role
    .split('_')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function ownerFromText(value: string): string | null {
  return (
    value.match(/\bowner\s*[:=-]\s*([^;,.]+)/i)?.[1]?.trim() ??
    value.match(/\bassignee\s*[:=-]\s*([^;,.]+)/i)?.[1]?.trim() ??
    null
  );
}

function mitigationFromText(value: string): string | null {
  return (
    value.match(/\bmitigation\s*[:=-]\s*([^;]+)/i)?.[1]?.trim() ??
    value.match(/\bfix\s*[:=-]\s*([^;]+)/i)?.[1]?.trim() ??
    null
  );
}

function dateFromText(value: string): string | null {
  const match = value.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return match?.[1] ?? null;
}

function titleCaseName(value: string): string {
  const cleaned = value.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
