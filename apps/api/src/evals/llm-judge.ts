/**
 * LLM-as-judge evaluator for RFP section drafts.
 *
 * Two tiers:
 * - Heuristic judge (default, CI-safe): no API calls; uses hallucination-detector
 *   for metric grounding and simple structural checks for relevance/completeness.
 * - LLM judge (EVAL_MODE=full): calls Claude to score quality axes in a
 *   structured JSON response. Requires ANTHROPIC_API_KEY in env.
 *
 * WHY two tiers: LLM evaluation costs ~$0.01 per section call. Running this
 * in every CI push would add significant cost and latency. The heuristic judge
 * catches the most common and most dangerous quality failure (hallucinated
 * metrics) without API overhead. The full LLM judge is reserved for periodic
 * evaluation or pre-release quality gates.
 */

import { detectPhantomMetrics } from './hallucination-detector.js';
import type { GoldenFixture } from './types.js';

export interface JudgeScore {
  /** Overall quality score 0-1. */
  overall: number;
  /** Hallucination score 0-1. 1 = no phantoms, 0 = all metrics are phantom. */
  hallucinationScore: number;
  /** Raw phantom rate 0-1 (phantoms / total metrics). */
  phantomRate: number;
  /**
   * Relevance score 0-1 (heuristic: section title words present in draft).
   * In LLM mode this is judged semantically.
   */
  relevanceScore: number;
  /**
   * Completeness score 0-1 (heuristic: draft >= 80 words).
   * In LLM mode this is judged semantically.
   */
  completenessScore: number;
  /** Phantom metric strings found in draft but absent from story context. */
  phantomMetrics: string[];
  /** Which judge tier was used. */
  mode: 'heuristic' | 'llm';
}

// ─── Heuristic judge ────────────────────────────────────────────────────────

const MIN_WORDS = 80;

/**
 * Score relevance by checking whether key words from the section title
 * appear in the draft. Very cheap and surprisingly effective for the
 * common failure mode where the agent drafts the wrong section.
 *
 * Floor of 0.5: proposal section titles like "Executive Summary" or
 * "Past Performance" often don't appear verbatim in the body text —
 * the heuristic falls back to 0.5 rather than 0.0 when keywords are
 * absent, deferring to hallucination + completeness for the final score.
 * True semantic relevance requires EVAL_MODE=full (LLM judge).
 */
function scoreRelevance(sectionTitle: string, draft: string): number {
  const titleWords = sectionTitle
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3); // skip short stop-words

  if (titleWords.length === 0) return 1;
  const draftLower = draft.toLowerCase();
  const hits = titleWords.filter((w) => draftLower.includes(w)).length;
  return Math.max(0.5, hits / titleWords.length);
}

/** Score completeness by word count. Drafts under MIN_WORDS are penalised. */
function scoreCompleteness(draft: string): number {
  const wordCount = draft.trim().split(/\s+/).length;
  if (wordCount >= MIN_WORDS) return 1;
  return wordCount / MIN_WORDS;
}

function judgeHeuristic(fixture: GoldenFixture): JudgeScore {
  const detection = detectPhantomMetrics(fixture.draft, fixture.storyContext);
  const hallucinationScore = 1 - detection.phantomRate;
  const relevanceScore = scoreRelevance(fixture.sectionTitle, fixture.draft);
  const completenessScore = scoreCompleteness(fixture.draft);

  // Weighted average: hallucination is the most critical axis (50% weight)
  const overall = hallucinationScore * 0.5 + relevanceScore * 0.25 + completenessScore * 0.25;

  return {
    overall,
    hallucinationScore,
    phantomRate: detection.phantomRate,
    relevanceScore,
    completenessScore,
    phantomMetrics: detection.phantomMetrics,
    mode: 'heuristic',
  };
}

// ─── LLM judge (full eval mode) ─────────────────────────────────────────────

const LLM_JUDGE_SYSTEM = `You are a quality evaluator for AI-generated RFP proposal sections.
You will receive:
- sectionTitle: the section being evaluated
- storyContext: the success story context injected into the draft prompt
- draft: the AI-generated section

Evaluate along three axes (0-1 each):
1. hallucination_score: 1.0 if every specific number/percentage/dollar in the draft appears in storyContext; lower for phantom metrics
2. relevance_score: 1.0 if the draft directly addresses the section title and uses the story context; lower otherwise
3. completeness_score: 1.0 if the draft covers all key points expected for the section type; lower if thin

Respond ONLY with valid JSON in this exact format:
{"hallucination_score": 0.0, "relevance_score": 0.0, "completeness_score": 0.0, "phantom_examples": [], "reasoning": ""}`;

async function judgeWithLLM(fixture: GoldenFixture): Promise<JudgeScore> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('EVAL_MODE=full requires ANTHROPIC_API_KEY in env');
  }

  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: LLM_JUDGE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          sectionTitle: fixture.sectionTitle,
          storyContext: fixture.storyContext,
          draft: fixture.draft,
        }),
      },
    ],
  });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };

  const text = data.content.find((c) => c.type === 'text')?.text ?? '{}';
  const parsed = JSON.parse(text) as {
    hallucination_score?: number;
    relevance_score?: number;
    completeness_score?: number;
    phantom_examples?: string[];
  };

  const hallucinationScore = parsed.hallucination_score ?? 0;
  const relevanceScore = parsed.relevance_score ?? 0;
  const completenessScore = parsed.completeness_score ?? 0;
  const overall = hallucinationScore * 0.5 + relevanceScore * 0.25 + completenessScore * 0.25;

  return {
    overall,
    hallucinationScore,
    phantomRate: 1 - hallucinationScore,
    relevanceScore,
    completenessScore,
    phantomMetrics: parsed.phantom_examples ?? [],
    mode: 'llm',
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Judge a single golden fixture.
 * - Uses heuristic judge by default (CI-safe, no API cost).
 * - Set EVAL_MODE=full to use the LLM judge (requires ANTHROPIC_API_KEY).
 */
export async function judgeFixture(fixture: GoldenFixture): Promise<JudgeScore> {
  if (process.env.EVAL_MODE === 'full') {
    return judgeWithLLM(fixture);
  }
  return judgeHeuristic(fixture);
}
