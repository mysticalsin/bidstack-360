// Deterministic contract-field extractor. Parses plain text (from a born-digital
// PDF, or OCR output) into a ContractExtractionDraft. This is the always-available
// baseline — an LLM pass (when configured) produces a higher-confidence draft;
// either way the user reviews/edits before it becomes a ContractAgreement.
//
// Pure + side-effect free so it is unit-testable without a DB, queue, or creds.
import type {
  ContractExtractionDraft,
  ContractKind,
  ContractRateSchedule,
  RateCardLine,
  RateCardUnit,
} from '@bidstack/shared';

const DETERMINISTIC_CONFIDENCE_BPS = 5200;

// Minimal country-name → ISO-2 map for the names that commonly appear in MSAs.
const COUNTRY_TO_ISO: Record<string, string> = {
  france: 'FR',
  germany: 'DE',
  spain: 'ES',
  portugal: 'PT',
  italy: 'IT',
  belgium: 'BE',
  netherlands: 'NL',
  luxembourg: 'LU',
  switzerland: 'CH',
  'united kingdom': 'GB',
  'great britain': 'GB',
  england: 'GB',
  ireland: 'IE',
  'united states': 'US',
  usa: 'US',
  canada: 'CA',
  brazil: 'BR',
  poland: 'PL',
  austria: 'AT',
  sweden: 'SE',
  norway: 'NO',
  denmark: 'DK',
};

function detectKind(text: string): ContractKind | null {
  const t = text.toLowerCase();
  if (/master\s+services?\s+agreement|\bmsa\b/.test(t)) return 'msa';
  if (/framework\s+agreement|\bframework\b/.test(t)) return 'framework';
  if (/statement\s+of\s+work|\bsow\b/.test(t)) return 'sow';
  if (/non[-\s]?disclosure|\bnda\b/.test(t)) return 'nda';
  return null;
}

function detectReference(text: string): string | null {
  // Labelled reference: "Reference: X", "Agreement No. X", "Contract No: X".
  const labelled = text.match(
    /(?:reference|agreement\s*(?:no\.?|number)|contract\s*(?:no\.?|number))\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9/\-_.]{2,40})/i,
  );
  if (labelled?.[1]) return labelled[1].replace(/[.,;]$/, '');
  // Otherwise an MSA/FA-style id token (e.g. MSA-2026-001).
  const idToken = text.match(/\b((?:MSA|FA|SOW|NDA|CTR)[-_][A-Za-z0-9][A-Za-z0-9/\-_]{2,30})\b/i);
  return idToken?.[1] ?? null;
}

function detectCurrency(text: string): string | null {
  const code = text.match(/\b(EUR|USD|GBP|CHF|CAD|BRL|SEK|NOK|DKK|JPY|AUD)\b/);
  if (code?.[1]) return code[1].toUpperCase();
  if (text.includes('€')) return 'EUR';
  if (text.includes('£')) return 'GBP';
  if (text.includes('$')) return 'USD';
  return null;
}

function detectCountries(text: string): string[] {
  const found = new Set<string>();
  // Explicit ISO-2 list (e.g. "Countries: FR, DE, ES").
  const labelled = text.match(/countries?\s*[:-]?\s*([A-Za-z]{2}(?:\s*[,/]\s*[A-Za-z]{2}){0,30})/i);
  if (labelled?.[1]) {
    for (const c of labelled[1].split(/[,/\s]+/)) {
      const code = c.trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(code)) found.add(code);
    }
  }
  // Country names anywhere in the text.
  const lower = text.toLowerCase();
  for (const [name, iso] of Object.entries(COUNTRY_TO_ISO)) {
    if (lower.includes(name)) found.add(iso);
  }
  return [...found].slice(0, 100);
}

function detectRebateBps(text: string): number | null {
  const m = text.match(/rebate[^%\d]{0,40}?(\d{1,2}(?:\.\d{1,2})?)\s*%/i);
  if (!m?.[1]) return null;
  const pct = Number(m[1]);
  return Number.isFinite(pct) ? Math.round(pct * 100) : null;
}

function detectRateSchedule(text: string): ContractRateSchedule | null {
  const m = text.match(/rate\s*(?:re-?(?:view|evaluation)|review)[^.]{0,60}/i);
  const scope = (m?.[0] ?? text).toLowerCase();
  if (/quarterly/.test(scope)) return 'quarterly';
  if (/bi-?annual|semi-?annual|twice\s+a\s+year/.test(scope)) return 'biannual';
  if (/annual|yearly|every\s+year/.test(scope)) return 'annual';
  if (/ad[-\s]?hoc/.test(scope)) return 'adhoc';
  return null;
}

function toIsoDate(raw: string): string | null {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function detectDates(text: string): { effectiveDate: string | null; expiryDate: string | null } {
  const dateRe = /(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}\s+\w+\s+\d{4})/;
  const eff = text.match(new RegExp(`(?:effective|start|commencement)\\s*(?:date)?\\s*[:\\-]?\\s*${dateRe.source}`, 'i'));
  const exp = text.match(new RegExp(`(?:expiry|expiration|end|termination|until)\\s*(?:date)?\\s*[:\\-]?\\s*${dateRe.source}`, 'i'));
  return {
    effectiveDate: eff?.[1] ? toIsoDate(eff[1]) : null,
    expiryDate: exp?.[1] ? toIsoDate(exp[1]) : null,
  };
}

const UNIT_RE: Record<string, RateCardUnit> = {
  day: 'day',
  daily: 'day',
  jour: 'day',
  hour: 'hour',
  hr: 'hour',
  month: 'month',
  mo: 'month',
  year: 'year',
  yr: 'year',
  annum: 'year',
};

function detectRateCard(text: string): RateCardLine[] {
  const lines: RateCardLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    // "Senior Consultant ... 850 / day" or "Architect: €1,100 per day".
    const m = raw.match(
      /^\s*([A-Za-z][A-Za-z /&'-]{2,60}?)\s*[:.\t|]*\s*[€£$]?\s*([\d.,]{2,12})\s*(?:\/|per|par)?\s*(day|daily|jour|hour|hr|month|mo|year|yr|annum)\b/i,
    );
    if (!m) continue;
    const role = m[1]!.trim().replace(/[:.-]+$/, '');
    const amount = Number(m[2]!.replace(/[,\s]/g, ''));
    const unit = UNIT_RE[m[3]!.toLowerCase()] ?? 'day';
    if (!role || !Number.isFinite(amount) || amount <= 0) continue;
    lines.push({ role, rateMicros: Math.round(amount * 1_000_000), unit });
    if (lines.length >= 200) break;
  }
  return lines;
}

/** Best-effort deterministic extraction of contract fields from document text. */
export function extractContractFields(text: string): ContractExtractionDraft {
  const dates = detectDates(text);
  const draft = {
    reference: detectReference(text),
    kind: detectKind(text),
    countries: detectCountries(text),
    currency: detectCurrency(text),
    globalRebateBps: detectRebateBps(text),
    effectiveDate: dates.effectiveDate,
    expiryDate: dates.expiryDate,
    rateReviewSchedule: detectRateSchedule(text),
    rateCard: detectRateCard(text),
    confidenceBps: DETERMINISTIC_CONFIDENCE_BPS,
    warnings: [] as string[],
  };
  if (!draft.reference) draft.warnings.push('No contract reference detected — enter it manually.');
  if (draft.rateCard.length === 0)
    draft.warnings.push('No rate-card lines detected — add them manually.');
  draft.warnings.push('Deterministic extraction — review every field before saving.');
  return draft;
}
