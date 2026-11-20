import type { InitiativeTheme } from '../schemas/account-signals.js';
import { strictThemeForText } from './posts.js';

/** What a filing sentence says about spending. */
export type StatementStance = 'invest' | 'cut' | 'guidance';

/** A sentence quoted verbatim from filing text. */
export interface ExtractedStatement {
  text: string;
  stance: StatementStance;
  theme: InitiativeTheme | null;
  /** Zero-based sentence index inside the section, for the citation locator. */
  index: number;
}

/** A stated priority with the evidence id of the filing excerpt it was quoted from. */
export interface StatementInput {
  evidenceId: string;
  text: string;
  stance: StatementStance;
  theme: InitiativeTheme | null;
}

const CUT = /\b(restructur\w*|reduc(e|es|ed|ing|tion) (of )?(our )?(costs?|headcount|workforce|spend\w*)|cost (reduction|savings?|cutting)|job cuts?|lay ?offs?|divest\w*|wind(ing)? down|clos(e|ed|ing|ure) (of )?\w+ (plants?|sites?|facilit\w*|offices?|operations)|exit(ed|ing)? (the|our)? ?\w+ (business|market))\b/i;
const GUIDANCE = /\b(we expect|we anticipate|we plan to|we intend to|expected to|outlook|guidance|forecast\w*|we will (invest|spend|continue|expand|launch)|targets? (of|for)|over the next (\d+|few|several|two|three) (years|months|quarters))\b/i;
const INVEST = /\b(invest(ed|ing|ment|ments|s)? (in|into|to)|capital expenditures? (on|for|in)|expand(ed|ing)? (our|the)|build(ing)? out|accelerat\w*|prioriti[sz]\w*|strategic priorit\w*|launch(ed|ing)?|develop(ed|ing)? (our|new)|moderni[sz]\w*|digiti[sz]\w*)\b/i;

const MAX_SENTENCE = 420;
const MAX_STATEMENTS = 24;

/** Sentences from filing text with an investment, cut or guidance stance. Deterministic. */
export function extractStatements(text: string): ExtractedStatement[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/);
  const out: ExtractedStatement[] = [];
  sentences.forEach((s, index) => {
    if (out.length >= MAX_STATEMENTS || s.length < 25 || s.length > MAX_SENTENCE) return;
    const stance: StatementStance | null = CUT.test(s) ? 'cut' : GUIDANCE.test(s) ? 'guidance' : INVEST.test(s) ? 'invest' : null;
    if (!stance) return;
    out.push({ text: s, stance, theme: strictThemeForText(s), index });
  });
  return out;
}
