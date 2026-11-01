/**
 * MSA leverage: an active MSA signed via entity X (often HEMA / pharma) with
 * no pipeline, projects or revenue in other group lines (IT, engineering,
 * digital). Scope/affiliates decide whether we can enter those lines as-is.
 */
import { detectBusinessLines, EXPANSION_LINES, isHemaPharmaLines, labelBusinessLine } from './business-lines.js';
import type { MsaCitation, MsaLeverageFlag } from '../schemas/msa-intake.js';

export interface LeverageMsaInput {
  msaId: string;
  msaTitle: string;
  status: string;
  expiryDate: string | null;
  companyId: string;
  companyName: string;
  signingEntity: {
    id: string;
    slug: string;
    name: string;
    brandFamily: 'mantu' | 'amaris' | 'other';
    businessLines: string[];
    verificationStatus: 'verified' | 'unverified';
  };
  scopeOfServices: string | null;
  affiliatesClause: string | null;
  scopeCitation: MsaCitation | null;
  affiliatesCitation: MsaCitation | null;
}

export interface AccountActivity {
  opportunityLines: string[];
  projectLines: string[];
  revenueLines: string[];
}

const OPEN_SCOPE =
  /\b(all services|any services|any and all|group companies|affiliates may|including (?:without limitation )?information technology|it services|engineering services|digital)\b/i;

function isActive(msa: LeverageMsaInput, now = Date.now()): boolean {
  if (msa.status !== 'active') return false;
  if (msa.expiryDate && Date.parse(msa.expiryDate) < now) return false;
  return true;
}

export function activityLines(activity: AccountActivity): Set<string> {
  return new Set([...activity.opportunityLines, ...activity.projectLines, ...activity.revenueLines]);
}

export function scopeAllowsExpansion(scope: string | null, affiliates: string | null): {
  allows: boolean | null;
  needsAmendment: boolean;
  citationFrom: 'scope' | 'affiliates' | null;
} {
  const blob = [scope, affiliates].filter(Boolean).join('\n');
  if (!blob.trim()) return { allows: null, needsAmendment: true, citationFrom: null };
  if (/does not include[^.]{0,200}(information technology|software engineering|digital transformation|it services)/i.test(blob)) {
    return { allows: false, needsAmendment: true, citationFrom: 'scope' };
  }
  if (OPEN_SCOPE.test(blob)) return { allows: true, needsAmendment: false, citationFrom: scope && OPEN_SCOPE.test(scope) ? 'scope' : 'affiliates' };
  const mentioned = detectBusinessLines(blob);
  const coversExpansion = EXPANSION_LINES.some((line) => mentioned.includes(line));
  if (coversExpansion) return { allows: true, needsAmendment: false, citationFrom: 'scope' };
  return { allows: false, needsAmendment: true, citationFrom: scope ? 'scope' : affiliates ? 'affiliates' : null };
}

export function leverageHeadline(entityName: string, slug: string, missing: string[]): string {
  const hema = slug === 'hema' || /hema|health economics/i.test(entityName);
  if (hema && missing.includes('it')) {
    return 'MSA in place via HEMA, no IT business yet: use the existing MSA to enter IT';
  }
  const missingLabel = missing.map(labelBusinessLine).join(', ');
  return `MSA in place via ${entityName}, no ${missingLabel} business yet: use the existing MSA to enter ${missingLabel}`;
}

export function evaluateLeverage(
  msa: LeverageMsaInput,
  activity: AccountActivity,
  now = Date.now(),
): MsaLeverageFlag | null {
  if (!isActive(msa, now)) return null;
  const covered = msa.signingEntity.businessLines;
  const present = activityLines(activity);
  // HEMA / pharma MSAs: any missing expansion line (IT, engineering, digital)
  // is a leverage flag. Other MSAs: only lines the signing entity does not
  // already cover, and the account has no activity in.
  const uniqueMissing = isHemaPharmaLines(covered)
    ? EXPANSION_LINES.filter((line) => !present.has(line))
    : EXPANSION_LINES.filter((line) => !covered.includes(line) && !present.has(line));
  if (uniqueMissing.length === 0) return null;

  const scope = scopeAllowsExpansion(msa.scopeOfServices, msa.affiliatesClause);
  const citation =
    scope.citationFrom === 'affiliates' ? msa.affiliatesCitation : scope.citationFrom === 'scope' ? msa.scopeCitation : msa.scopeCitation ?? msa.affiliatesCitation;

  return {
    companyId: msa.companyId,
    companyName: msa.companyName,
    msaId: msa.msaId,
    msaTitle: msa.msaTitle,
    signingEntity: {
      id: msa.signingEntity.id,
      slug: msa.signingEntity.slug,
      name: msa.signingEntity.name,
      brandFamily: msa.signingEntity.brandFamily,
      businessLines: msa.signingEntity.businessLines,
      verificationStatus: msa.signingEntity.verificationStatus,
    },
    coveredLines: covered,
    missingLines: uniqueMissing,
    headline: leverageHeadline(msa.signingEntity.name, msa.signingEntity.slug, uniqueMissing),
    scopeAllowsOtherServices: scope.allows,
    scopeNeedsAmendment: scope.needsAmendment,
    scopeCitation: citation,
  };
}
