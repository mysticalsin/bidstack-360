// Target-field catalog for the CSV import wizard. Mirrors the fields the
// migration worker actually writes (apps/worker/src/queues/migration.ts entity
// writers). Mapping values sent to start-csv are these `key`s (or null to skip
// a source column).

export type ImportEntity = 'company' | 'contact' | 'lead' | 'opportunity' | 'financial';

export interface TargetField {
  key: string;
  label: string;
  required?: boolean;
}

export const IMPORT_ENTITIES: { value: ImportEntity; label: string }[] = [
  { value: 'company', label: 'Companies / Accounts' },
  { value: 'contact', label: 'Contacts' },
  { value: 'lead', label: 'Leads' },
  { value: 'opportunity', label: 'Opportunities / Deals' },
  { value: 'financial', label: 'Account financials' },
];

export const TARGET_FIELDS: Record<ImportEntity, TargetField[]> = {
  company: [
    { key: 'company.name', label: 'Name', required: true },
    { key: 'company.domain', label: 'Domain' },
    { key: 'company.website', label: 'Website' },
    { key: 'company.industry', label: 'Industry' },
    { key: 'company.employeeCount', label: 'Employee count' },
    { key: 'company.countryCode', label: 'Country code' },
  ],
  contact: [
    { key: 'contact.firstName', label: 'First name' },
    { key: 'contact.lastName', label: 'Last name' },
    { key: 'contact.name', label: 'Full name' },
    { key: 'contact.email', label: 'Email', required: true },
    { key: 'contact.companyName', label: 'Company name' },
    { key: 'contact.title', label: 'Job title' },
    { key: 'contact.phone', label: 'Phone' },
    { key: 'contact.mobile', label: 'Mobile' },
  ],
  lead: [
    { key: 'lead.firstName', label: 'First name' },
    { key: 'lead.lastName', label: 'Last name' },
    { key: 'lead.email', label: 'Email' },
    { key: 'lead.companyName', label: 'Company name' },
    { key: 'lead.status', label: 'Status' },
    { key: 'lead.title', label: 'Job title' },
    { key: 'lead.phone', label: 'Phone' },
    { key: 'lead.notes', label: 'Notes' },
  ],
  opportunity: [
    { key: 'opportunity.name', label: 'Name', required: true },
    { key: 'opportunity.customer', label: 'Customer / company', required: true },
    { key: 'opportunity.valueMicros', label: 'Value (amount)' },
    { key: 'opportunity.stage', label: 'Stage' },
    { key: 'opportunity.probability', label: 'Probability (%)' },
    { key: 'opportunity.closeDate', label: 'Close date' },
  ],
  financial: [
    { key: 'financial.companyName', label: 'Account name', required: true },
    { key: 'financial.periodEnd', label: 'Period end (YYYY-MM-DD)', required: true },
    { key: 'financial.currency', label: 'Currency', required: true },
    { key: 'financial.revenue', label: 'Revenue (amount)' },
    { key: 'financial.operatingIncome', label: 'Operating income' },
    { key: 'financial.netIncome', label: 'Net income' },
    { key: 'financial.periodType', label: 'Period type (FY or Q)' },
    { key: 'financial.fiscalYear', label: 'Fiscal year' },
    { key: 'financial.periodStart', label: 'Period start (YYYY-MM-DD)' },
  ],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Best-effort auto-mapping of CSV headers to target fields by normalized name.
 * A header maps to the first field whose label or key tail it matches; each
 * target field is used at most once. Returns a { header: fieldKey | null } map.
 */
export function autoMap(
  headers: string[],
  fields: TargetField[],
): Record<string, string | null> {
  const used = new Set<string>();
  const result: Record<string, string | null> = {};

  for (const header of headers) {
    const nh = normalize(header);
    let match: string | null = null;
    for (const field of fields) {
      if (used.has(field.key)) continue;
      const tail = field.key.split('.')[1] ?? field.key;
      if (nh === normalize(field.label) || nh === normalize(tail)) {
        match = field.key;
        break;
      }
    }
    if (match) used.add(match);
    result[header] = match;
  }

  return result;
}

// One obviously synthetic row per entity so a new workspace can download a
// file, see the columns, and delete the sample before importing real rows.
const TEMPLATE_EXAMPLES: Record<ImportEntity, Record<string, string>> = {
  company: {
    'company.name': 'Harbor Synthetic',
    'company.domain': 'harbor-synthetic.example',
    'company.website': 'https://harbor-synthetic.example',
    'company.industry': 'consulting',
    'company.employeeCount': '12',
    'company.countryCode': 'CA',
  },
  contact: {
    'contact.firstName': 'Avery',
    'contact.lastName': 'Founder',
    'contact.name': 'Avery Founder',
    'contact.email': 'avery.founder@harbor-synthetic.example',
    'contact.companyName': 'Harbor Synthetic',
    'contact.title': 'Founder',
    'contact.phone': '+1-555-0100',
    'contact.mobile': '+1-555-0101',
  },
  lead: {
    'lead.firstName': 'Avery',
    'lead.lastName': 'Founder',
    'lead.email': 'avery.founder@harbor-synthetic.example',
    'lead.companyName': 'Harbor Synthetic',
    'lead.status': 'new',
    'lead.title': 'Founder',
    'lead.phone': '+1-555-0100',
    'lead.notes': 'Synthetic example. Delete this row before importing.',
  },
  opportunity: {
    'opportunity.name': 'Harbor Synthetic pilot bid',
    'opportunity.customer': 'Harbor Synthetic',
    'opportunity.valueMicros': '120000',
    'opportunity.stage': 'Lead',
    'opportunity.probability': '20',
    'opportunity.closeDate': '2026-12-31',
  },
  financial: {
    'financial.companyName': 'Harbor Synthetic',
    'financial.periodEnd': '2026-12-31',
    'financial.currency': 'CAD',
    'financial.revenue': '1000',
    'financial.operatingIncome': '100',
    'financial.netIncome': '80',
    'financial.periodType': 'FY',
    'financial.fiscalYear': '2026',
    'financial.periodStart': '2026-01-01',
  },
};

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

/** Header labels match TARGET_FIELDS so autoMap fills the wizard without a manual match. */
export function importTemplateCsv(entity: ImportEntity): string {
  const fields = TARGET_FIELDS[entity];
  const examples = TEMPLATE_EXAMPLES[entity];
  const header = fields.map((field) => csvCell(field.label)).join(',');
  const row = fields.map((field) => csvCell(examples[field.key] ?? '')).join(',');
  return `${header}\n${row}\n`;
}
