import { titleCase } from './accountUtils';

/**
 * Demo industries are stored as codes (`financial_services`).
 * The label is words. The filter request keeps the stored code.
 */
export function accountIndustryLabel(industry: string): string {
  return titleCase(industry.trim());
}
