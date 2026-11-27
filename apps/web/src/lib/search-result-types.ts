/**
 * Words for the records workspace search actually returns.
 * Sales orders are not in that set: the type is tolerated on the wire and
 * nothing emits it. Proposals, requirements, and references are.
 */

export const SEARCH_RESULT_TABS = [
  'all',
  'opportunity',
  'lead',
  'contact',
  'company',
  'task',
  'note',
  'proposal',
  'rfp_requirement',
  'reference',
] as const;

export type SearchTabKey = (typeof SEARCH_RESULT_TABS)[number];

const TAB_LABELS: Record<SearchTabKey, string> = {
  all: 'All',
  opportunity: 'Opportunities',
  lead: 'Leads',
  contact: 'Contacts',
  company: 'Companies',
  task: 'Tasks',
  note: 'Notes',
  proposal: 'Proposals',
  rfp_requirement: 'Requirements',
  reference: 'References',
};

const TYPE_LABELS: Record<Exclude<SearchTabKey, 'all'>, string> = {
  opportunity: 'Opportunity',
  lead: 'Lead',
  contact: 'Contact',
  company: 'Company',
  task: 'Task',
  note: 'Note',
  proposal: 'Proposal',
  rfp_requirement: 'Requirement',
  reference: 'Reference',
};

/** Short row badge in the command palette. Same length as opp / acct / todo. */
const PALETTE_TAGS: Record<string, string> = {
  proposal: 'prop',
  rfp_requirement: 'req',
  reference: 'ref',
};

export const SEARCH_PLACEHOLDER =
  'Search across opportunities, contacts, companies, tasks, notes, proposals, and references…';

export const SEARCH_GUIDANCE =
  'Type a keyword above to find opportunities, contacts, companies, tasks, notes, proposals, and references.';

export const SEARCH_TAB_EMPTY_TITLE = 'No {{type}}';

export const SEARCH_TAB_EMPTY_MESSAGE =
  'Other matches are on All. Nothing in {{type}} for "{{query}}".';

export function isSearchTab(value: string | null | undefined): value is SearchTabKey {
  return typeof value === 'string' && (SEARCH_RESULT_TABS as readonly string[]).includes(value);
}

export function searchTabLabel(key: string): string {
  return isSearchTab(key) ? TAB_LABELS[key] : 'Results';
}

/** Badge on a result row. An unknown type, including sales_order, stays a word. */
export function searchTypeLabel(type: string): string {
  // `all` is a tab, not a row type. TYPE_LABELS omits it, and isSearchTab still
  // returns that full tab union, so the index has to exclude `all` itself.
  if (!isSearchTab(type) || type === 'all') return 'Result';
  return TYPE_LABELS[type];
}

/** Accessible name for a palette group the nav list does not already name. */
export function paletteGroupLabel(group: string): string | null {
  if (!isSearchTab(group) || group === 'all') return null;
  if (group === 'proposal' || group === 'rfp_requirement' || group === 'reference') {
    return TAB_LABELS[group];
  }
  return null;
}

export function paletteGroupTag(group: string): string | null {
  return PALETTE_TAGS[group] ?? null;
}
