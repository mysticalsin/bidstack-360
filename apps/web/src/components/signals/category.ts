// Signal categories: label, colour and lane. Colours follow polo-DESIGN.md:
// one accent, status colours always paired with a text label.
import type { SignalCategory } from '@bidstack/shared';

export const CATEGORY_LABEL: Record<SignalCategory, string> = {
  funding: 'Funding',
  launch: 'Launch',
  initiative: 'Initiative',
  exec_move: 'Exec move',
  risk: 'Risk',
  earnings: 'Earnings',
  hiring: 'Hiring',
  m_and_a: 'M&A',
  partnership: 'Partnership',
  filing: 'Filing',
  market: 'Market / analyst',
  news: 'News',
  meeting: 'Meeting',
  deal: 'Deal',
  bid: 'Bid',
};

/** Five colour families keep the timeline readable: growth, change, risk, results, ours. */
export const CATEGORY_TONE: Record<SignalCategory, 'growth' | 'change' | 'risk' | 'results' | 'ours' | 'neutral'> = {
  funding: 'growth',
  launch: 'growth',
  initiative: 'growth',
  partnership: 'growth',
  hiring: 'growth',
  exec_move: 'change',
  m_and_a: 'change',
  risk: 'risk',
  earnings: 'results',
  filing: 'results',
  market: 'neutral',
  news: 'neutral',
  meeting: 'ours',
  deal: 'ours',
  bid: 'ours',
};

export const THEIR_FILTERS: SignalCategory[] = ['funding', 'launch', 'initiative', 'exec_move', 'm_and_a', 'partnership', 'hiring', 'earnings', 'risk', 'filing', 'market', 'news'];
export const OUR_FILTERS: SignalCategory[] = ['meeting', 'deal', 'bid'];

/** UI copy never shows em or en dashes (provider titles sometimes carry them). */
export const noDash = (s: string) => s.replace(/^Sample:\s*/i, '').replace(/\s*[\u2014\u2013]\s*/g, ', ');

export const SOURCE_LABEL: Record<string, string> = {
  sec_edgar: 'SEC EDGAR',
  companies_house: 'Companies House',
  amf: 'AMF',
  ir_feed: 'Investor relations',
  gdelt: 'GDELT news',
  google_news: 'Google News',
  company_rss: 'Company newsroom',
  apify_linkedin: 'LinkedIn (Apify)',
  apollo: 'Apollo',
  seamless: 'Seamless',
  enrichment: 'Hiring signals',
  meeting_intel: 'Meeting intel',
  financials: 'Filed financials',
  sample: 'Sample data',
};

export const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s;
