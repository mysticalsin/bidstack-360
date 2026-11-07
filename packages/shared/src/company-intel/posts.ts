import { classifySignalText, themeForText, type InitiativeTheme } from '../schemas/account-signals.js';
import type { IntelPostKind } from './types.js';

const EXPANSION_WORDS = /\b(expan\w*|new office|new market|opens?|growth|funding|raises?|series [a-h])\b/i;

/** Theme named by the text, or null when nothing specific matched. */
export function strictThemeForText(text: string): InitiativeTheme | null {
  const t = themeForText(text);
  return t === 'expansion' && !EXPANSION_WORDS.test(text) ? null : t;
}

const KIND_BY_SIGNAL: Record<string, IntelPostKind> = {
  M_AND_A: 'acquisition',
  EARNINGS_RELEASE: 'results',
  PRODUCT_LAUNCH: 'product',
  LEADERSHIP_CHANGE: 'leadership',
  LAYOFFS: 'layoffs',
  PARTNERSHIP: 'partnership',
  STRATEGIC_INITIATIVE: 'expansion',
  HIRING_SPIKE: 'expansion',
  FUNDING_ROUND: 'expansion',
};

/** Display label per post type. */
export const POST_KIND_LABEL: Record<IntelPostKind, string> = {
  product: 'Product',
  partnership: 'Partnership',
  acquisition: 'Acquisition',
  leadership: 'Leadership',
  results: 'Results',
  layoffs: 'Layoffs',
  expansion: 'Expansion',
  other: 'Other',
};

/** Post type and theme for a company post or news headline, via the shared news classifier. */
export function classifyPost(title: string, description = ''): { kind: IntelPostKind; theme: InitiativeTheme | null } {
  const sig = classifySignalText(title, description);
  const kind = KIND_BY_SIGNAL[sig.kind] ?? 'other';
  let theme: InitiativeTheme | null;
  if (kind === 'acquisition') theme = 'm_and_a';
  else if (kind === 'layoffs') theme = 'workforce';
  else if (kind === 'results' || kind === 'leadership' || kind === 'other') theme = null;
  else theme = strictThemeForText(title) ?? (kind === 'expansion' ? 'expansion' : null);
  return { kind, theme };
}
