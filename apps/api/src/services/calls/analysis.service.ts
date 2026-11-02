/**
 * AI call analysis service — uses Anthropic Claude via the existing Dust client
 * (or direct ANTHROPIC_API_KEY fallback) to extract:
 *  - Executive summary
 *  - Action items with owners
 *  - MEDDIC signals (Metric, Economic Buyer, Decision Criteria, Decision Process,
 *    Identify Pain, Champion)
 *  - Sentiment score (-1 to +1)
 *  - Talk ratio per speaker
 *  - Suggested deal-stage updates (human-in-the-loop)
 *
 * WHY per Rule 5 (model only for judgment calls): deterministic extraction
 * (durations, participant count, timestamps) is computed in code. Only
 * classification-shaped work (sentiment, MEDDIC identification, summary)
 * routes to the LLM.
 *
 * WHY Anthropic Claude fallback instead of Dust: the Dust agent is designed
 * for bid/presales document analysis. Call transcript analysis is a different
 * workload; using the Anthropic SDK directly gives tighter schema control.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { TranscriptSegment } from './transcription.service.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ActionItem {
  owner: string;
  description: string;
  /** ISO 8601 date string if a due date was mentioned, else null. */
  dueDate: string | null;
}

export interface MeddicSignal {
  dimension:
    | 'METRIC'
    | 'ECONOMIC_BUYER'
    | 'DECISION_CRITERIA'
    | 'DECISION_PROCESS'
    | 'IDENTIFY_PAIN'
    | 'CHAMPION';
  /** Human-readable evidence. */
  value: string;
  confidence: number;
  sourceQuoteRef: string | null;
}

export interface CallInsight {
  summary: string;
  actionItems: ActionItem[];
  meddicSignals: MeddicSignal[];
  /** −1.0 to +1.0. Positive = prospect positive, negative = concern/objection. */
  sentimentScore: number;
  /** Per-speaker talk percentages { "Speaker 0": 0.42, ... }. Sum = 1.0. */
  talkRatio: Record<string, number>;
  /**
   * Suggested deal updates — each is a high-confidence signal that implies a
   * stage, amount, or close-date change. The rep must approve via notification.
   */
  dealSuggestions: Array<{
    field: 'stage' | 'amount' | 'closeDate' | 'nextStep';
    suggestedValue: string;
    rationale: string;
    confidence: number;
  }>;
}

// ─── Talk ratio computation (deterministic — no LLM) ────────────────────────

/**
 * Computes per-speaker talk percentages from transcript segments.
 * WHY computed in code: simple arithmetic; routing to LLM would waste tokens.
 */
export function computeTalkRatio(segments: TranscriptSegment[]): Record<string, number> {
  const speakerMs: Record<string, number> = {};

  for (const seg of segments) {
    const duration = seg.endMs - seg.startMs;
    speakerMs[seg.speaker] = (speakerMs[seg.speaker] ?? 0) + duration;
  }

  const total = Object.values(speakerMs).reduce((sum, ms) => sum + ms, 0);
  if (total === 0) return {};

  const result: Record<string, number> = {};
  for (const [speaker, ms] of Object.entries(speakerMs)) {
    result[speaker] = Math.round((ms / total) * 1_000) / 1_000; // 3 dp
  }
  return result;
}

// ─── LLM analysis ───────────────────────────────────────────────────────────

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('CallAnalysis: ANTHROPIC_API_KEY env var is required');
  return new Anthropic({ apiKey });
}

const ANALYSIS_SYSTEM_PROMPT = `You are an expert sales call analyst specializing in B2B enterprise sales.
You analyze call transcripts and extract structured insights.
Always respond with valid JSON matching the provided schema exactly.
Be conservative with confidence scores — only score 0.9+ when evidence is explicit.
MEDDIC framework: Metric (quantified value), Economic Buyer (budget authority), Decision Criteria (evaluation factors),
Decision Process (buying process steps), Identify Pain (business problems), Champion (internal advocate).`;

const ANALYSIS_USER_TEMPLATE = (transcript: string) => `Analyze this sales call transcript and extract the following in JSON:

TRANSCRIPT:
${transcript}

Return ONLY valid JSON with this exact structure:
{
  "summary": "string (max 300 words, executive summary)",
  "actionItems": [{"owner": "string", "description": "string", "dueDate": "ISO8601 date or null"}],
  "meddicSignals": [{
    "dimension": "METRIC|ECONOMIC_BUYER|DECISION_CRITERIA|DECISION_PROCESS|IDENTIFY_PAIN|CHAMPION",
    "value": "string",
    "confidence": 0.0-1.0,
    "sourceQuoteRef": "verbatim quote or null"
  }],
  "sentimentScore": -1.0 to 1.0,
  "dealSuggestions": [{
    "field": "stage|amount|closeDate|nextStep",
    "suggestedValue": "string",
    "rationale": "string",
    "confidence": 0.0-1.0
  }]
}`;

/**
 * Analyzes a sales call transcript using Claude.
 * Returns structured insights including MEDDIC signals and deal suggestions.
 *
 * @param transcriptText - Full transcript text (speaker-tagged or flat).
 * @param segments - Speaker segments for talk-ratio computation (computed in code).
 */
export async function analyzeCallTranscript(
  transcriptText: string,
  segments: TranscriptSegment[],
): Promise<CallInsight> {
  // Talk ratio is deterministic — compute in code, not LLM
  const talkRatio = computeTalkRatio(segments);

  // Truncate transcript to avoid exceeding context window (keep ~100k chars = ~25k tokens)
  const truncated = transcriptText.length > 100_000
    ? transcriptText.slice(0, 100_000) + '\n[TRANSCRIPT TRUNCATED]'
    : transcriptText;

  const client = getAnthropicClient();
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-7';

  const message = await client.messages.create({
    model,
    max_tokens: 4_096,
    system: ANALYSIS_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: ANALYSIS_USER_TEMPLATE(truncated) }],
  });

  const content = message.content[0];
  if (!content || content.type !== 'text') {
    throw new Error('CallAnalysis: Anthropic returned no text content');
  }

  // Strip markdown code fences if present
  const rawJson = content.text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();

  let parsed: {
    summary: string;
    actionItems: ActionItem[];
    meddicSignals: MeddicSignal[];
    sentimentScore: number;
    dealSuggestions: CallInsight['dealSuggestions'];
  };

  try {
    parsed = JSON.parse(rawJson) as typeof parsed;
  } catch {
    throw new Error(`CallAnalysis: Failed to parse LLM response as JSON: ${rawJson.slice(0, 200)}`);
  }

  return {
    summary: parsed.summary ?? '',
    actionItems: parsed.actionItems ?? [],
    meddicSignals: parsed.meddicSignals ?? [],
    sentimentScore: Math.max(-1, Math.min(1, parsed.sentimentScore ?? 0)),
    talkRatio,
    dealSuggestions: parsed.dealSuggestions ?? [],
  };
}

/**
 * Maps a MeddicSignal dimension to a CallSummary key string.
 * WHY: CallSummary.key stores string keys that can also include non-MEDDIC
 * signals (EXECUTIVE_BUYER_PRESENT, BUDGET_DISCUSSED, etc.).
 */
export function meddicDimensionToKey(dimension: MeddicSignal['dimension']): string {
  const keyMap: Record<MeddicSignal['dimension'], string> = {
    METRIC: 'MEDDIC_METRIC',
    ECONOMIC_BUYER: 'MEDDIC_ECONOMIC_BUYER',
    DECISION_CRITERIA: 'MEDDIC_DECISION_CRITERIA',
    DECISION_PROCESS: 'MEDDIC_DECISION_PROCESS',
    IDENTIFY_PAIN: 'MEDDIC_IDENTIFY_PAIN',
    CHAMPION: 'MEDDIC_CHAMPION',
  };
  return keyMap[dimension];
}
