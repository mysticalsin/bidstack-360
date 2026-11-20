// LLM refinement pass for contract extraction.
//
// The open-source OCR stage (OCRmyPDF / Tesseract / optional OmniParse, in
// extract-text.ts) turns a scanned MSA into plain text. This stage hands that
// text to WHATEVER LLM provider the org has made active (Kimi / GPT / Claude /
// NVIDIA NIM / local Gemma — resolved by the caller) to produce a high-quality
// structured draft, instead of the deterministic regex baseline.
//
// Contract: returns a validated ContractExtractionDraft, or null on ANY failure
// (no provider, call error, malformed/oversized JSON, schema mismatch). Null lets
// the caller fall back to the deterministic extractor. The draft is ALWAYS
// review-required — it never auto-creates a ContractAgreement.
//
// We ask the model for LLM-friendly shapes (a rebate percent, a plain rate
// number, YYYY-MM-DD dates) and normalise them into the strict wire types
// (bps, micros, ISO-8601) here, so prompt drift can't push bad values downstream.

import { ContractExtractionDraft } from '@bidstack/shared';
import { completeChat, coerceJsonObject, type ResolvedLlm } from './llm-provider.js';

const LLM_CONFIDENCE_BPS = 8500;
// Bound the prompt so a huge contract can't blow the model's context / our cost.
// Key terms + the rate table usually sit in the first pages; annex-only rate
// cards are a known limitation surfaced as a warning.
const MAX_INPUT_CHARS = 60_000;
const MAX_OUTPUT_TOKENS = 2_000;

const KIND_VALUES = new Set(['msa', 'framework', 'sow', 'nda', 'other']);
const SCHEDULE_VALUES = new Set(['annual', 'biannual', 'quarterly', 'adhoc']);
const UNIT_VALUES = new Set(['day', 'hour', 'month', 'year', 'fixed']);

const SYSTEM_PROMPT =
  'You extract structured fields from B2B services contracts (MSAs, framework ' +
  'agreements, SOWs). Respond with ONE JSON object and nothing else. Use null ' +
  'for anything not clearly stated — never guess. Do not invent rate-card lines.';

function buildUserPrompt(text: string): string {
  return `From the contract text below, extract this exact JSON shape:
{
  "reference": string|null,            // contract/agreement number, e.g. "MSA-2026-001"
  "kind": "msa"|"framework"|"sow"|"nda"|"other"|null,
  "countries": string[],               // ISO-3166 alpha-2 codes, e.g. ["FR","DE"]
  "currency": string|null,             // ISO-4217, e.g. "EUR"
  "globalRebatePercent": number|null,  // overall rebate as a percent, e.g. 7.5
  "effectiveDate": string|null,        // "YYYY-MM-DD"
  "expiryDate": string|null,           // "YYYY-MM-DD"
  "rateReviewSchedule": "annual"|"biannual"|"quarterly"|"adhoc"|null,
  "rateCard": [                        // negotiated day/hour rates per role; [] if none
    { "role": string, "rate": number, "unit": "day"|"hour"|"month"|"year"|"fixed", "currency": string|null }
  ]
}

Rules: amounts are plain numbers (no currency symbols, no thousands separators).
Only include rate-card lines that are explicitly stated. Return [] / null rather
than guessing.

--- CONTRACT TEXT ---
${text.slice(0, MAX_INPUT_CHARS)}`;
}

function asString(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, max) : null;
}

function asFiniteNumber(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.replace(/[,\s]/g, '')) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function asCurrency(v: unknown): string | null {
  // Exact ISO-4217 token only — never truncate "dollars" into "DOL".
  const code = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function toIsoDate(v: unknown): string | null {
  const s = asString(v, 40);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeCountries(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const item of v) {
    // Require an exact ISO-2 token — never truncate a longer string into one
    // (so "France" is dropped, not silently turned into "FR").
    const code = typeof item === 'string' ? item.trim().toUpperCase() : '';
    if (/^[A-Z]{2}$/.test(code)) out.add(code);
  }
  return [...out].slice(0, 100);
}

function normalizeRateCard(v: unknown): Array<{ role: string; rateMicros: number; unit: string; currency?: string | null }> {
  if (!Array.isArray(v)) return [];
  const lines: Array<{ role: string; rateMicros: number; unit: string; currency?: string | null }> = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const role = asString(r.role, 120);
    const rate = asFiniteNumber(r.rate);
    if (!role || rate === null || rate <= 0) continue;
    const unitRaw = asString(r.unit, 10)?.toLowerCase() ?? 'day';
    const unit = UNIT_VALUES.has(unitRaw) ? unitRaw : 'day';
    const currency = asCurrency(r.currency);
    lines.push({ role, rateMicros: Math.round(rate * 1_000_000), unit, currency });
    if (lines.length >= 200) break;
  }
  return lines;
}

/**
 * Run the configured LLM over the (OCR'd) contract text and return a validated
 * draft, or null on any failure so the caller falls back to deterministic.
 */
export async function extractContractFieldsLLM(
  text: string,
  llm: ResolvedLlm,
  signal?: AbortSignal,
): Promise<ContractExtractionDraft | null> {
  let response: string;
  try {
    response = await completeChat(llm, {
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(text),
      responseFormat: 'json_object',
      maxTokens: MAX_OUTPUT_TOKENS,
      signal,
    });
  } catch {
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    const obj = JSON.parse(coerceJsonObject(response)) as unknown;
    if (!obj || typeof obj !== 'object') return null;
    parsed = obj as Record<string, unknown>;
  } catch {
    return null;
  }

  const kind = asString(parsed.kind, 20)?.toLowerCase();
  const schedule = asString(parsed.rateReviewSchedule, 20)?.toLowerCase();
  const rebatePct = asFiniteNumber(parsed.globalRebatePercent);

  const draft = {
    reference: asString(parsed.reference, 255),
    kind: kind && KIND_VALUES.has(kind) ? kind : null,
    countries: normalizeCountries(parsed.countries),
    currency: asCurrency(parsed.currency),
    globalRebateBps:
      rebatePct === null ? null : Math.min(100_000, Math.max(0, Math.round(rebatePct * 100))),
    effectiveDate: toIsoDate(parsed.effectiveDate),
    expiryDate: toIsoDate(parsed.expiryDate),
    rateReviewSchedule: schedule && SCHEDULE_VALUES.has(schedule) ? schedule : null,
    rateCard: normalizeRateCard(parsed.rateCard),
    confidenceBps: LLM_CONFIDENCE_BPS,
    warnings: [
      `AI-assisted extraction (${llm.kind}) — review every field before saving.`,
    ] as string[],
  };

  // Validate the NORMALISED object against the strict wire schema. A model that
  // returns junk for one field can't poison the draft — it fails here and the
  // caller uses the deterministic result instead.
  const result = ContractExtractionDraft.safeParse(draft);
  return result.success ? result.data : null;
}
