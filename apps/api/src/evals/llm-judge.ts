/**
 * LLM-as-judge evaluator for RFP section drafts.
 *
 * Two tiers:
 * - Heuristic judge (default, CI-safe): no API calls; uses hallucination-detector
 *   for metric grounding and simple structural checks for relevance/completeness.
 * - LLM judge (EVAL_MODE=full): calls Anthropic or NVIDIA NIM to score quality
 *   axes in a structured JSON response.
 *
 * WHY two tiers: LLM evaluation costs ~$0.01 per section call. Running this
 * in every CI push would add significant cost and latency. The heuristic judge
 * catches the most common and most dangerous quality failure (hallucinated
 * metrics) without API overhead. The full LLM judge is reserved for periodic
 * evaluation or pre-release quality gates.
 */

import { z } from 'zod';

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

const EvalProvider = z.enum(['anthropic', 'nim', 'nvidia', 'nvidia-nim']);

const JudgeResponse = z.object({
  hallucination_score: z.coerce.number().min(0).max(1),
  relevance_score: z.coerce.number().min(0).max(1),
  completeness_score: z.coerce.number().min(0).max(1),
  phantom_examples: z.array(z.string()).default([]),
});

function coerceJsonObject(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

function resolveEvalProvider(): z.infer<typeof EvalProvider> {
  const raw = (process.env.EVAL_LLM_PROVIDER ?? 'anthropic').trim().toLowerCase();
  const parsed = EvalProvider.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Unsupported EVAL_LLM_PROVIDER: ${raw || '(empty)'}`);
  }
  return parsed.data;
}

function resolveNimEvalBaseUrl(): string {
  const candidate = (process.env.NVIDIA_NIM_BASE_URL ?? 'https://integrate.api.nvidia.com/v1')
    .replace(/\/$/, '');
  const url = new URL(candidate);
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'integrate.api.nvidia.com') {
    throw new Error('NVIDIA NIM eval judge base URL must be https://integrate.api.nvidia.com/v1');
  }
  return candidate;
}

async function judgeWithLLM(fixture: GoldenFixture): Promise<JudgeScore> {
  const provider = resolveEvalProvider();
  const isNim = provider === 'nim' || provider === 'nvidia' || provider === 'nvidia-nim';
  const apiKey = isNim ? process.env.NVIDIA_NIM_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      isNim
        ? 'EVAL_MODE=full with EVAL_LLM_PROVIDER=nim requires NVIDIA_NIM_API_KEY in env'
        : 'EVAL_MODE=full requires ANTHROPIC_API_KEY in env',
    );
  }

  if (isNim) {
    return judgeWithOpenAiCompatible(fixture, {
      apiKey,
      baseUrl: resolveNimEvalBaseUrl(),
      model: process.env.NVIDIA_NIM_MODEL ?? 'deepseek-ai/deepseek-v4-pro',
      extraBody: {
        chatTemplateKwargs: { thinking: process.env.NVIDIA_NIM_THINKING === 'true' },
      },
    });
  }

  return judgeWithAnthropic(fixture, apiKey);
}

async function judgeWithAnthropic(fixture: GoldenFixture, apiKey: string): Promise<JudgeScore> {
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

  return scoreParsedLLMJson(data.content.find((c) => c.type === 'text')?.text ?? '{}');
}

async function judgeWithOpenAiCompatible(
  fixture: GoldenFixture,
  llm: {
    apiKey: string;
    baseUrl: string;
    model: string;
    extraBody?: { chatTemplateKwargs?: { thinking: boolean } };
  },
): Promise<JudgeScore> {
  const response = await fetch(`${llm.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${llm.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: llm.model,
      messages: [
        { role: 'system', content: LLM_JUDGE_SYSTEM },
        {
          role: 'user',
          content: JSON.stringify({
            sectionTitle: fixture.sectionTitle,
            storyContext: fixture.storyContext,
            draft: fixture.draft,
          }),
        },
      ],
      max_tokens: 512,
      temperature: 0,
      response_format: { type: 'json_object' },
      ...(llm.extraBody?.chatTemplateKwargs
        ? { chat_template_kwargs: llm.extraBody.chatTemplateKwargs }
        : {}),
    }),
  });

  if (response.status !== 200) {
    throw new Error(`NVIDIA NIM eval judge error: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) {
    throw new Error('NVIDIA NIM eval judge returned empty content');
  }
  return scoreParsedLLMJson(content);
}

function scoreParsedLLMJson(text: string): JudgeScore {
  const parsed = JudgeResponse.parse(JSON.parse(coerceJsonObject(text)));

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
 * - Set EVAL_MODE=full to use the LLM judge. Default is Anthropic; set
 *   EVAL_LLM_PROVIDER=nim to judge through NVIDIA NIM.
 */
export async function judgeFixture(fixture: GoldenFixture): Promise<JudgeScore> {
  if (process.env.EVAL_MODE === 'full') {
    return judgeWithLLM(fixture);
  }
  return judgeHeuristic(fixture);
}
