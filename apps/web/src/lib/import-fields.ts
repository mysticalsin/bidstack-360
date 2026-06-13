// Target-field catalog for the CSV import wizard. Mirrors the fields the
// migration worker actually writes (apps/worker/src/queues/migration.ts entity
// writers). Mapping values sent to start-csv are these `key`s (or null to skip
// a source column).

export type ImportEntity = 'company' | 'contact' | 'lead' | 'opportunity';

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
