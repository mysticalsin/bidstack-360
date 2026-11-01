/**
 * Match OUR signing entity from the parties clause. HEMA aliases are first-class.
 */
import type { MsaExtractedFields, MsaSigningEntityMatch } from '../schemas/msa-intake.js';

export interface SigningEntityCandidate {
  id: string | null;
  slug: string;
  name: string;
  legalName: string | null;
  aliases: string[];
}

function norm(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function haystack(fields: MsaExtractedFields): string {
  const parts: string[] = [];
  for (const key of ['ourParty', 'clientParty', 'parties'] as const) {
    const value = fields[key].value;
    if (typeof value === 'string') parts.push(value);
    if (Array.isArray(value)) parts.push(JSON.stringify(value));
  }
  return norm(parts.join(' '));
}

export function rankSigningEntityMatches(
  candidates: SigningEntityCandidate[],
  fields: MsaExtractedFields,
  limit = 5,
): MsaSigningEntityMatch[] {
  const text = haystack(fields);
  if (!text) return [];
  const scored: MsaSigningEntityMatch[] = [];
  for (const candidate of candidates) {
    const labels = [candidate.name, candidate.legalName ?? '', ...candidate.aliases].filter(Boolean);
    let best = 0;
    let alias: string | null = null;
    const reasons: string[] = [];
    for (const label of labels) {
      const n = norm(label);
      if (!n || n.length < 3) continue;
      if (text === n) {
        best = 9800;
        alias = label;
        reasons.push(`Exact party match on ${label}`);
      } else if (text.includes(n)) {
        const score = n === 'hema' || n.includes('health economics') ? 9600 : n.length >= 12 ? 9000 : 8200;
        if (score > best) {
          best = score;
          alias = label;
        }
        reasons.push(`Parties clause names ${label}`);
      }
    }
    if (best >= 4000) {
      scored.push({
        entityId: candidate.id,
        slug: candidate.slug,
        name: candidate.name,
        scoreBps: best,
        alias,
        reasons: [...new Set(reasons)],
      });
    }
  }
  return scored.sort((a, b) => b.scoreBps - a.scoreBps).slice(0, limit);
}
