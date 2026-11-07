/**
 * Stated priorities and guidance from filing text (slice 12).
 *
 * Sources: the latest 10-K (Item 7, MD&A) or 20-F (Item 5) from SEC EDGAR,
 * and the narrative text blocks of the latest ESEF report. Every statement
 * is a verbatim sentence with the section it came from. The optional LLM
 * pass may only pick sentences: anything it returns that is not found word
 * for word in the source text is dropped, and the deterministic extractor
 * runs whenever the LLM is off or returns nothing usable.
 */
import { extractStatements, strictThemeForText, type InitiativeTheme, type StatementStance } from '@bidstack/shared';

import { padCik } from '../financials/sources.js';
import type { IntelClient } from './http.js';

/** One section of filing text with a human locator. */
export interface FilingSection {
  locator: string;
  text: string;
  url: string | null;
}

/** A statement ready for the evidence ledger. */
export interface StatementRow {
  text: string;
  stance: StatementStance;
  theme: InitiativeTheme | null;
  locator: string;
  url: string | null;
  method: 'rules' | 'llm';
}

/** LLM seam: system and user prompt in, raw JSON text out. */
export type StatementLlm = (input: { system: string; user: string }) => Promise<string>;

const MAX_SECTION = 150_000;
const MAX_STATEMENTS = 15;

/** Visible text from an HTML filing. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8217;|&rsquo;/g, '\u2019')
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** The MD&A section of a 10-K (Item 7) or the operating review of a 20-F (Item 5), skipping the table of contents. */
export function annualReportSection(text: string, form: string): FilingSection | null {
  const start = form.startsWith('20-F') ? /item\s*5\.?\s*[:.-]?\s*operating and financial review/gi : /item\s*7\.?\s*[:.-]?\s*management.{0,3}s discussion and analysis/gi;
  const end = form.startsWith('20-F') ? /item\s*6\.?\s*[:.-]?\s*directors/i : /item\s*7a\.?|item\s*8\.?\s*[:.-]?\s*financial statements/i;
  let best: string | null = null;
  for (const m of text.matchAll(start)) {
    const rest = text.slice(m.index! + m[0].length);
    const stop = rest.search(end);
    const body = (stop >= 0 ? rest.slice(0, stop) : rest).slice(0, MAX_SECTION);
    if (!best || body.length > best.length) best = body;
  }
  if (!best || best.length < 2000) return null;
  return { locator: form.startsWith('20-F') ? '20-F Item 5, Operating and financial review' : '10-K Item 7, MD&A', text: best.replace(/\n/g, ' '), url: null };
}

/** Latest annual report MD&A from EDGAR for a CIK, or null when none is filed. */
export async function edgarAnnualReportSection(client: IntelClient, cik: string): Promise<FilingSection | null> {
  const id = padCik(cik);
  const sub = JSON.parse(await client.get(`https://data.sec.gov/submissions/CIK${id}.json`, { accept: 'application/json' })) as {
    filings?: { recent?: { form?: string[]; accessionNumber?: string[]; primaryDocument?: string[]; reportDate?: string[] } };
  };
  const r = sub.filings?.recent;
  const i = r?.form?.findIndex((f) => f === '10-K' || f === '20-F' || f === '40-F') ?? -1;
  if (!r || i < 0 || !r.accessionNumber?.[i] || !r.primaryDocument?.[i]) return null;
  const form = r.form![i]!;
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(id)}/${r.accessionNumber[i]!.replace(/-/g, '')}/${r.primaryDocument[i]}`;
  const section = annualReportSection(htmlToText(await client.get(url, { accept: 'text/html' })), form);
  if (!section) return null;
  const period = r.reportDate?.[i] ? ` for the period ended ${r.reportDate[i]}` : '';
  return { ...section, locator: `${section.locator}${period}`, url };
}

/** ESEF narrative blocks as sections, one per concept. */
export function esefSections(blocks: Array<{ concept: string; text: string }>, url: string | null): FilingSection[] {
  return blocks
    .map((b) => ({ locator: `ESEF ${b.concept.replace(/^[a-z-]+:/i, '')}`, text: htmlToText(b.text).replace(/\n/g, ' ').slice(0, MAX_SECTION), url }))
    .filter((s) => s.text.length > 200);
}

const SYSTEM = [
  'You read a company filing for a B2B sales team.',
  'Pick sentences in which the company states where it invests, where it cuts costs, or what it expects next (guidance).',
  'Copy each sentence exactly as written, character for character. Do not paraphrase, shorten or merge sentences.',
  'Answer with JSON only: {"statements":[{"quote":"...","stance":"invest|cut|guidance"}]}, at most 10 items.',
].join(' ');

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

function deterministic(sections: FilingSection[]): StatementRow[] {
  const out: StatementRow[] = [];
  for (const s of sections) {
    for (const st of extractStatements(s.text)) {
      out.push({ text: st.text, stance: st.stance, theme: st.theme, locator: `${s.locator}, sentence ${st.index + 1}`, url: s.url, method: 'rules' });
      if (out.length >= MAX_STATEMENTS) return out;
    }
  }
  return out;
}

async function viaLlm(sections: FilingSection[], llm: StatementLlm): Promise<StatementRow[]> {
  const out: StatementRow[] = [];
  for (const s of sections.slice(0, 3)) {
    const chunk = s.text.slice(0, 24_000);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await llm({ system: SYSTEM, user: chunk }));
    } catch {
      continue;
    }
    const rows = (parsed as { statements?: unknown }).statements;
    if (!Array.isArray(rows)) continue;
    const hay = norm(chunk);
    for (const r of rows) {
      const row = r as Record<string, unknown>;
      const quote = typeof row.quote === 'string' ? norm(row.quote) : '';
      const stance = row.stance === 'invest' || row.stance === 'cut' || row.stance === 'guidance' ? row.stance : null;
      if (!stance || quote.length < 25 || quote.length > 420 || !hay.includes(quote)) continue;
      out.push({ text: quote, stance, theme: strictThemeForText(quote), locator: s.locator, url: s.url, method: 'llm' });
      if (out.length >= MAX_STATEMENTS) return out;
    }
  }
  return out;
}

/** Stated priorities from filing sections: LLM when configured and verifiable, else rules. */
export async function statementsFromSections(sections: FilingSection[], llm: StatementLlm | null): Promise<StatementRow[]> {
  if (!sections.length) return [];
  if (llm) {
    try {
      const picked = await viaLlm(sections, llm);
      if (picked.length) return picked;
    } catch {
      // fall through to rules
    }
  }
  return deterministic(sections);
}
