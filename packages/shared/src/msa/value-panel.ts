/**
 * "Where we can bring value" items for one MSA. Each item cites a clause or
 * its absence. Nothing is invented.
 */
import { detectBusinessLines, EXPANSION_LINES, labelBusinessLine } from './business-lines.js';
import { LONG_PAYMENT_DAYS, LOW_LIABILITY_CAP_UNITS } from '../schemas/msa-intake.js';
import type { MsaApproachContact, MsaCitation, MsaValueItem, MsaValuePanel } from '../schemas/msa-intake.js';

export interface ValuePanelMsa {
  msaId: string;
  expiryDate: string | null;
  noticeDeadline: string | null;
  autoRenew: boolean;
  liabilityCapMicros: number | null;
  liabilityCapCurrency: string | null;
  paymentTerms: string | null;
  indexation: string | null;
  exclusivity: string | null;
  nonSolicit: string | null;
  scopeOfServices: string | null;
  citations: Record<string, MsaCitation | undefined>;
}

export interface OfferedLine {
  line: string;
  brandName: string;
}

function paymentDays(terms: string | null): number | null {
  if (!terms) return null;
  const m = terms.match(/net\s+(\d{1,3})/i);
  return m ? Number(m[1]) : null;
}

function daysUntil(iso: string | null, now: number): number | null {
  if (!iso) return null;
  return Math.round((Date.parse(iso) - now) / 86_400_000);
}

function cite(citations: ValuePanelMsa['citations'], key: string): MsaCitation | null {
  return citations[key] ?? null;
}

export function buildValuePanel(
  msa: ValuePanelMsa,
  offered: OfferedLine[],
  approach: MsaApproachContact | null,
  now = Date.now(),
): MsaValuePanel {
  const items: MsaValueItem[] = [];
  const scopeText = msa.scopeOfServices ?? '';
  const scopeLines = /does not include/i.test(scopeText) ? [] : detectBusinessLines(scopeText);
  const offeredLines = [...new Set(offered.map((o) => o.line))];
  for (const line of offeredLines) {
    if (scopeLines.includes(line as (typeof EXPANSION_LINES)[number])) continue;
    if (scopeText && !/does not include/i.test(scopeText) && scopeText.toLowerCase().includes(labelBusinessLine(line).toLowerCase())) continue;
    const brands = offered.filter((o) => o.line === line).map((o) => o.brandName);
    items.push({
      id: `uncovered:${line}`,
      kind: 'uncovered_service',
      title: `${labelBusinessLine(line)} is not in the current scope`,
      detail: `${brands[0] ?? 'Our brands'} offer ${labelBusinessLine(line)}. The MSA scope does not mention it.`,
      citation: cite(msa.citations, 'scopeOfServices'),
      absence: !msa.scopeOfServices,
      approach,
    });
  }

  const toExpiry = daysUntil(msa.expiryDate, now);
  const toNotice = daysUntil(msa.noticeDeadline, now);
  if (toExpiry != null && toExpiry >= 0 && toExpiry <= 180) {
    items.push({
      id: 'renewal:expiry',
      kind: 'renewal_window',
      title: `Expiry in ${toExpiry} days`,
      detail: msa.autoRenew
        ? 'Auto-renewal is on. Use the window to expand scope or renegotiate terms.'
        : 'The MSA ends unless it is renewed. Use the window to expand or renegotiate.',
      citation: cite(msa.citations, 'expiryDate') ?? cite(msa.citations, 'renewalTerms'),
      absence: false,
      approach,
    });
  } else if (toNotice != null && toNotice >= 0 && toNotice <= 90) {
    items.push({
      id: 'renewal:notice',
      kind: 'renewal_window',
      title: `Notice due in ${toNotice} days`,
      detail: 'Last window to give notice, or to reopen scope and commercial terms.',
      citation: cite(msa.citations, 'noticePeriodDays'),
      absence: false,
      approach,
    });
  }

  if (msa.liabilityCapMicros == null) {
    items.push({
      id: 'weak:liability-missing',
      kind: 'weak_clause',
      title: 'Liability cap not found',
      detail: 'No liability cap was extracted. Confirm the clause before relying on this MSA.',
      citation: null,
      absence: true,
      approach,
    });
  } else if (msa.liabilityCapMicros < LOW_LIABILITY_CAP_UNITS * 1_000_000) {
    items.push({
      id: 'weak:liability-low',
      kind: 'weak_clause',
      title: 'Low liability cap',
      detail: 'The extracted cap is below 1,000,000 in the contract currency. Worth renegotiating at renewal.',
      citation: cite(msa.citations, 'liabilityCap'),
      absence: false,
      approach,
    });
  }

  const days = paymentDays(msa.paymentTerms);
  if (!msa.paymentTerms) {
    items.push({
      id: 'weak:payment-missing',
      kind: 'weak_clause',
      title: 'Payment terms not found',
      detail: 'No payment terms were extracted from the document.',
      citation: null,
      absence: true,
      approach,
    });
  } else if (days != null && days >= LONG_PAYMENT_DAYS) {
    items.push({
      id: 'weak:payment-long',
      kind: 'weak_clause',
      title: 'Long payment terms',
      detail: `Extracted payment terms are net ${days} days.`,
      citation: cite(msa.citations, 'paymentTerms'),
      absence: false,
      approach,
    });
  }

  if (!msa.indexation || /no indexation/i.test(msa.indexation)) {
    items.push({
      id: 'weak:indexation',
      kind: 'weak_clause',
      title: msa.indexation ? 'No indexation' : 'Indexation not found',
      detail: msa.indexation
        ? 'Rates are not indexed. Raise this at renewal.'
        : 'No indexation clause was extracted.',
      citation: cite(msa.citations, 'indexation'),
      absence: !msa.indexation,
      approach,
    });
  }

  if (msa.exclusivity && /exclusive/i.test(msa.exclusivity) && !/non-exclusive/i.test(msa.exclusivity)) {
    items.push({
      id: 'weak:exclusivity',
      kind: 'weak_clause',
      title: 'Restrictive exclusivity',
      detail: 'The MSA names an exclusive appointment. Check whether it blocks other lines.',
      citation: cite(msa.citations, 'exclusivity'),
      absence: false,
      approach,
    });
  }

  if (msa.nonSolicit) {
    const months = msa.nonSolicit.match(/(\d{1,2})\s+months/i);
    if (months && Number(months[1]) > 12) {
      items.push({
        id: 'weak:nonsolicit',
        kind: 'weak_clause',
        title: 'Long non-solicit',
        detail: `Non-solicit runs for ${months[1]} months after expiry.`,
        citation: cite(msa.citations, 'nonSolicit'),
        absence: false,
        approach,
      });
    }
  }

  return { msaId: msa.msaId, items };
}
