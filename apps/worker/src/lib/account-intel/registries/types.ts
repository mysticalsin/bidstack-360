import type { ExtractedPeriod } from '../../financials/xbrl.js';

/** One fiscal year read from a business registry, with the page it came from. */
export interface RegistryPeriod extends ExtractedPeriod {
  sourceUrl: string;
}

/** A dated registry fact (status, incorporation, SIC codes, last accounts). */
export interface RegistryFact {
  label: string;
  value: string;
}

/** Strip common legal-form suffixes and punctuation so "DNB Bank" matches "DNB BANK ASA". */
export function normaliseLegalName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b([a-z])\.(?=[a-z]\b\.?)/g, '$1')
    .replace(/[.,'’&()-]/g, ' ')
    .replace(/\b(asa|as|ab|abp|oyj|oy|sa|sas|sasu|sarl|se|ag|gmbh|kgaa|kg|co|nv|bv|spa|srl|plc|ltd|limited|llc|inc|incorporated|corp|corporation|group|holding|holdings|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
