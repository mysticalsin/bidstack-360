/**
 * Score candidate CRM accounts against names, addresses and email domains
 * found in an MSA. Pure: the caller loads candidates from the database.
 */
import type { MsaAccountMatch, MsaExtractedFields } from '../schemas/msa-intake.js';

export interface AccountCandidate {
  companyId: string;
  name: string;
  legalName: string | null;
  domain: string | null;
  address: string | null;
  emails: string[];
}

const MIN_SCORE = 4000;

function norm(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(value: string): Set<string> {
  return new Set(norm(value).split(' ').filter((t) => t.length > 1 && !['sas', 'ltd', 'inc', 'gmbh', 'the', 'and'].includes(t)));
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let n = 0;
  for (const t of a) if (b.has(t)) n += 1;
  return n / Math.max(a.size, b.size);
}

function domainOf(email: string): string | null {
  const at = email.toLowerCase().split('@')[1];
  return at && at.includes('.') ? at : null;
}

export function accountSignals(fields: MsaExtractedFields): { names: string[]; emails: string[]; addresses: string[] } {
  const names: string[] = [];
  const emails: string[] = [];
  const addresses: string[] = [];
  const client = fields.clientParty.value;
  if (typeof client === 'string' && client.trim()) names.push(client);
  const parties = fields.parties.value;
  if (Array.isArray(parties)) {
    for (const party of parties) {
      if (!party || typeof party !== 'object') continue;
      const row = party as { name?: unknown; role?: unknown; email?: unknown; address?: unknown };
      if (row.role === 'ours') continue;
      if (typeof row.name === 'string') names.push(row.name);
      if (typeof row.email === 'string') emails.push(row.email);
      if (typeof row.address === 'string') addresses.push(row.address);
    }
  }
  return { names, emails, addresses };
}

export function scoreAccount(candidate: AccountCandidate, signals: ReturnType<typeof accountSignals>): MsaAccountMatch | null {
  const reasons: string[] = [];
  let score = 0;
  const candNames = [candidate.name, candidate.legalName ?? ''].filter(Boolean);
  for (const signal of signals.names) {
    const nSignal = norm(signal);
    for (const cand of candNames) {
      const nCand = norm(cand);
      if (!nCand) continue;
      if (nSignal === nCand) {
        score = Math.max(score, 9500);
        reasons.push(`Exact name match on ${cand}`);
      } else if (nSignal.includes(nCand) || nCand.includes(nSignal)) {
        score = Math.max(score, 7800);
        reasons.push(`Name contained in party "${signal}"`);
      } else {
        const o = overlap(tokens(signal), tokens(cand));
        if (o >= 0.6) {
          score = Math.max(score, Math.round(5000 + o * 2500));
          reasons.push(`Partial name overlap with ${cand}`);
        }
      }
    }
  }
  for (const email of signals.emails) {
    const domain = domainOf(email);
    if (!domain) continue;
    if (candidate.domain && domain === candidate.domain.toLowerCase()) {
      score = Math.max(score, 8800);
      reasons.push(`Signatory email domain matches ${domain}`);
    }
    if (candidate.emails.some((e) => e.toLowerCase() === email.toLowerCase())) {
      score = Math.max(score, 9200);
      reasons.push('Signatory email matches a contact');
    }
  }
  if (candidate.address && signals.addresses.length) {
    for (const addr of signals.addresses) {
      const o = overlap(tokens(addr), tokens(candidate.address));
      if (o >= 0.5) {
        score = Math.max(score, 6500);
        reasons.push('Address overlap with the parties clause');
      }
    }
  }
  if (score < MIN_SCORE || reasons.length === 0) return null;
  return {
    companyId: candidate.companyId,
    name: candidate.name,
    legalName: candidate.legalName,
    domain: candidate.domain,
    scoreBps: score,
    reasons: [...new Set(reasons)],
  };
}

export function rankAccountMatches(
  candidates: AccountCandidate[],
  fields: MsaExtractedFields,
  limit = 5,
): MsaAccountMatch[] {
  const signals = accountSignals(fields);
  return candidates
    .map((c) => scoreAccount(c, signals))
    .filter((m): m is MsaAccountMatch => Boolean(m))
    .sort((a, b) => b.scoreBps - a.scoreBps)
    .slice(0, limit);
}
