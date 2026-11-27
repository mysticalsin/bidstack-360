/**
 * Name stored when a lead is converted and the caller left the name blank.
 *
 * The convert field shows the company and the word Opportunity in that case.
 * Demo leads have a job title. Using the title filed the bid under the role.
 */
const BLANK_MARK = '\u2014';

export function convertOpportunityName(input: {
  opportunityName?: string | null;
  companyName?: string | null;
}): string {
  const typed = input.opportunityName?.trim() ?? '';
  if (typed.length > 0) return typed;
  const company = input.companyName?.trim() ?? '';
  if (company.length === 0) return 'Opportunity';
  return `${company} ${BLANK_MARK} Opportunity`;
}
