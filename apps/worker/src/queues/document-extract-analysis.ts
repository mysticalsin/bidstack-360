// Deterministic text-analysis functions for document extraction.
// No I/O, no Prisma, no BullMQ — pure logic that can be unit-tested in
// isolation or swapped out for an LLM-backed variant.

import { createHash } from 'node:crypto';

import {
  SOLUTION_KEYWORDS,
  PRODUCT_KEYWORDS,
  CATEGORY_MAP,
  WIN_PHRASES,
  LOSS_PHRASES,
  WIN_LOSS_REASON_KEYWORDS,
  type ExtractedItem,
  type ExtractionResult,
  type SourceChunkCandidate,
  type RequirementCandidate,
  type WinLossSignal,
} from './document-extract-types.js';

// Learn a win/loss pattern from raw document text. Pure + deterministic so it can
// be unit-tested and runs even with no LLM configured. Returns null when the
// document shows no win/loss signal (the common case for MSAs / rate cards), so
// callers only attach a signal when something was genuinely detected.
// Word-boundary match so a short keyword never fires inside an unrelated word:
// 'fit' must not match 'benefit', 'sla' not 'translate'/'legislation', 'cost' not
// 'costume'. Substring matching here silently corrupted the learned reason tags.
function containsWord(haystackLower: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(haystackLower);
}

export function detectWinLossSignal(text: string): WinLossSignal | null {
  const lower = text.toLowerCase();

  const lost = LOSS_PHRASES.some((p) => containsWord(lower, p));
  const won = WIN_PHRASES.some((p) => containsWord(lower, p));
  // Loss precedence: a debrief comparing deals teaches us most from the loss.
  const outcome: WinLossSignal['outcome'] = lost ? 'lost' : won ? 'won' : 'unknown';

  // No explicit outcome phrase => not a win/loss document. Emit nothing so a
  // routine MSA/SOW that merely mentions "pricing" or "deadline" never surfaces a
  // misleading win/loss chip (reasons alone are not a signal).
  if (outcome === 'unknown') return null;

  const reasons: string[] = [];
  for (const [tag, keywords] of Object.entries(WIN_LOSS_REASON_KEYWORDS)) {
    if (keywords.some((k) => containsWord(lower, k))) reasons.push(tag);
  }

  return { outcome, reasons, competitors: [], summary: null };
}

// Reason tags the LLM may return: the deterministic keyword tags plus
// 'competitor' (only the LLM can name a competitor, so the regex path never
// emits it). Single source so the detector, prompt, and normalizer can't drift.
const ALLOWED_LLM_REASON_TAGS = new Set([
  ...Object.keys(WIN_LOSS_REASON_KEYWORDS),
  'competitor',
]);

// Coerce an LLM-provided winLoss object into the strict WinLossSignal shape.
// Defensive: the model may omit fields, return wrong types, or hallucinate an
// outcome — clamp to known values and drop unknown reason tags so the stored
// signal stays trustworthy for aggregation. Pure (no I/O) → unit-tested.
export function normalizeWinLoss(raw: unknown): WinLossSignal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as {
    outcome?: unknown;
    reasons?: unknown;
    competitors?: unknown;
    summary?: unknown;
  };
  const outcome: WinLossSignal['outcome'] =
    r.outcome === 'won' || r.outcome === 'lost' ? r.outcome : 'unknown';
  const reasons = Array.isArray(r.reasons)
    ? [
        ...new Set(
          r.reasons
            .map((x) => String(x).toLowerCase().trim())
            .filter((x) => ALLOWED_LLM_REASON_TAGS.has(x)),
        ),
      ]
    : [];
  const competitors = Array.isArray(r.competitors)
    ? [...new Set(r.competitors.map((x) => String(x).slice(0, 80).trim()).filter(Boolean))].slice(
        0,
        10,
      )
    : [];
  const summary =
    typeof r.summary === 'string' && r.summary.trim() ? r.summary.slice(0, 300) : null;
  if (outcome === 'unknown' && reasons.length === 0 && competitors.length === 0) return null;
  return { outcome, reasons, competitors, summary };
}

export function detectCategory(text: string): string {
  const lower = text.toLowerCase();
  for (const [keyword, category] of Object.entries(CATEGORY_MAP)) {
    if (lower.includes(keyword)) return category;
  }
  return 'general';
}

export function deterministicExtract(text: string): ExtractionResult {
  const lines = text.split(/\n+/).map((l) => l.trim());
  const solutions: ExtractedItem[] = [];
  const products: ExtractedItem[] = [];
  const seen = new Set<string>();

  // Track section context (e.g. "Solutions:" / "Products:" headers)
  let currentSection: 'solution' | 'product' | null = null;

  for (const line of lines) {
    if (line.length < 3) continue;

    const lower = line.toLowerCase();

    // Detect section headers
    if (/^solutions?\s*[:\-–]/.test(lower)) {
      currentSection = 'solution';
      continue;
    }
    if (/^products?\s*[:\-–]/.test(lower) || /^offerings?\s*[:\-–]/.test(lower)) {
      currentSection = 'product';
      continue;
    }

    // Match bullet points, numbered lists, or plain lines with separators
    const match = line.match(/^[-•*\d.)]+\s*(.+?)(?:\s*[-–:]\s*(.*))?$/);
    if (!match) {
      // Also try matching plain "Name — Description" or "Name: Description" lines
      const plainMatch = line.match(/^(.{3,80}?)\s*[-–:]\s*(.{5,})$/);
      if (plainMatch && line.length > 10 && line.length < 300) {
        const name = (plainMatch[1] ?? '').trim().slice(0, 120);
        const desc = (plainMatch[2] ?? '').trim().slice(0, 500);
        if (name) classifyAndPush(name, desc, line, currentSection, solutions, products, seen);
      }
      continue;
    }

    const name = (match[1] ?? '').trim().slice(0, 120);
    const desc = (match[2] ?? '').trim().slice(0, 500);
    if (!name || seen.has(name.toLowerCase())) continue;

    classifyAndPush(name, desc, line, currentSection, solutions, products, seen);
  }

  if (solutions.length === 0 && products.length === 0) {
    const firstParagraph = text.split(/\n\n+/)[0]?.slice(0, 300) ?? '';
    if (firstParagraph.length > 50) {
      solutions.push({
        name: 'General Offering',
        description: firstParagraph,
        category: 'general',
      });
    }
  }

  return { solutions, products, winLoss: detectWinLossSignal(text) };
}

function classifyAndPush(
  name: string,
  desc: string,
  line: string,
  section: 'solution' | 'product' | null,
  solutions: ExtractedItem[],
  products: ExtractedItem[],
  seen: Set<string>,
): void {
  if (!name || seen.has(name.toLowerCase())) return;
  seen.add(name.toLowerCase());

  const lower = line.toLowerCase();
  const isSolution = SOLUTION_KEYWORDS.some((k) => lower.includes(k));
  const isProduct = PRODUCT_KEYWORDS.some((k) => lower.includes(k));

  const item: ExtractedItem = {
    name,
    description: desc || line.slice(0, 200),
    category: detectCategory(line),
  };

  // Section context overrides keyword heuristics when present
  if (section === 'solution') {
    solutions.push(item);
  } else if (section === 'product') {
    products.push(item);
  } else if (isSolution || (!isProduct && lower.includes('solution'))) {
    solutions.push(item);
  } else if (isProduct) {
    products.push(item);
  } else {
    // No strong signal — default to solution if it sounds like a capability
    const serviceLike =
      /(?:migration|transformation|assessment|audit|consulting|support|management|operations)$/i;
    if (serviceLike.test(name)) {
      solutions.push(item);
    }
  }
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function buildSourceChunks(text: string): SourceChunkCandidate[] {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) return [];

  const chunks: SourceChunkCandidate[] = [];
  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  let current = '';

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > 1800 && current) {
      chunks.push({
        chunkIndex: chunks.length,
        text: current,
        hash: hashText(current),
      });
      current = paragraph;
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push({
      chunkIndex: chunks.length,
      text: current,
      hash: hashText(current),
    });
  }

  if (chunks.length === 0 && normalized) {
    chunks.push({ chunkIndex: 0, text: normalized.slice(0, 1800), hash: hashText(normalized) });
  }

  return chunks.slice(0, 250);
}

function splitRequirementSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((line) => line.replace(/^[-•*\d.)\s]+/, '').trim())
    .filter((line) => line.length >= 24 && line.length <= 700);
}

function looksLikeRequirement(text: string): boolean {
  return /\b(must|shall|required|requires|requirement|mandatory|provide|submit|include|comply|compliance|evidence|deadline|due|response|supplier|vendor|bidder|proponent)\b/i.test(
    text,
  );
}

function classifyRequirementType(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(price|pricing|commercial|cost|fee|discount|tax|invoice|payment)\b/.test(lower)) {
    return 'commercial';
  }
  if (/\b(legal|contract|liability|indemnity|terms|privacy|gdpr|data protection)\b/.test(lower)) {
    return 'legal';
  }
  if (
    /\b(security|soc 2|iso 27001|penetration|vulnerability|encryption|access control)\b/.test(lower)
  ) {
    return 'security';
  }
  if (/\b(sla|support|service desk|availability|incident|response time)\b/.test(lower)) {
    return 'service';
  }
  if (
    /\b(deliverable|implementation|architecture|integration|technical|migration|cloud)\b/.test(
      lower,
    )
  ) {
    return 'technical';
  }
  return 'general';
}

function requirementPriority(text: string): RequirementCandidate['priority'] {
  const lower = text.toLowerCase();
  if (/\b(disqualif|mandatory|must not|shall not|penalty|deadline|privacy|breach)\b/.test(lower)) {
    return 'critical';
  }
  if (/\b(must|shall|required|security|compliance|legal|evidence)\b/.test(lower)) {
    return 'high';
  }
  if (/\b(should|requested|prefer|include|provide)\b/.test(lower)) {
    return 'medium';
  }
  return 'low';
}

export function extractRequirementCandidates(
  chunks: SourceChunkCandidate[],
): RequirementCandidate[] {
  const candidates: RequirementCandidate[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    for (const sentence of splitRequirementSentences(chunk.text)) {
      if (!looksLikeRequirement(sentence)) continue;
      const key = sentence.toLowerCase().replace(/\s+/g, ' ').slice(0, 240);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        externalRef: `REQ-${String(candidates.length + 1).padStart(3, '0')}`,
        text: sentence,
        requirementType: classifyRequirementType(sentence),
        mandatory: /\b(must|shall|required|mandatory)\b/i.test(sentence),
        priority: requirementPriority(sentence),
        confidenceBps: /\b(must|shall|required|mandatory|deadline)\b/i.test(sentence) ? 7800 : 6400,
        sourceChunkIndex: chunk.chunkIndex,
      });
      if (candidates.length >= 120) return candidates;
    }
  }

  return candidates;
}
