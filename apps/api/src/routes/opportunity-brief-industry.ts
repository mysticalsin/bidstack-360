/**
 * Demo bids store an industry key such as financial_services.
 * The opportunity record title-cases that picker catalog.
 * A stored value that is not in the catalog stays as written.
 * A blank industry stays "not set", which is the line the brief already used.
 */
const DEMO_INDUSTRY_NAME: Readonly<Record<string, string>> = {
  financial_services: 'Financial Services',
  insurance: 'Insurance',
  healthcare: 'Healthcare',
  manufacturing: 'Manufacturing',
  retail: 'Retail',
  technology: 'Technology',
  energy: 'Energy',
  government: 'Government',
  education: 'Education',
  telecom: 'Telecom',
  transportation: 'Transportation',
  logistics: 'Logistics',
  media: 'Media',
  real_estate: 'Real Estate',
  professional_services: 'Professional Services',
  other: 'Other',
};

export function opportunityBriefIndustry(industry: string | null | undefined): string {
  const trimmed = industry?.trim() ?? '';
  if (trimmed.length === 0) return 'not set';
  return DEMO_INDUSTRY_NAME[trimmed] ?? trimmed;
}
