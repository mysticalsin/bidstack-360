/**
 * ai-assistant.helpers.ts — shared constants, types, Redis/Prisma utilities.
 *
 * WHY separate from orchestration: all utilities here are stateless or leaf
 * Redis/Prisma operations. Keeping them here keeps service.ts focused on the
 * cap-check → context → LLM → parse → persist flow and makes each piece
 * independently testable.
 *
 * Import DAG: this file has zero local sibling imports — leaf node.
 */
import type { Logger as PinoLogger } from 'pino';

import { prisma } from '@bidstack/db';
import { DustClient } from '@bidstack/dust-client';

import { redis } from '../redis.js';

// ─── Cost model constants ─────────────────────────────────────────────────
// Per-user daily cap used when org has no OrgSettings row yet.
export const DEFAULT_DAILY_CAP_MICROS = BigInt(5_000_000); // $5.00
export const DEFAULT_DAILY_SESSION_CAP = 100;

// Rough cost estimate: GPT-4o-equivalent at $5/1M input + $15/1M output.
// Real cost comes from Dust usage telemetry when available; this is the
// fallback for when usage data is absent.
export const COST_PER_TOKEN_INPUT_MICROS = 5n; // $0.000005 → 5 micros
export const COST_PER_TOKEN_OUTPUT_MICROS = 15n;

// Model identifier recorded on every session.
export const AI_MODEL = 'dust-agent-v1';

// ─── Redis cost-cap key helpers ───────────────────────────────────────────
// We accumulate per-user cost in a rolling UTC-day window.
// Key: bidstack:ai:daily:<orgId>:<userId>:<YYYY-MM-DD>
// Value: stringified BigInt micros, TTL 48 h.

export function dailyCostKey(orgId: string, userId: string, nowMs = Date.now()): string {
  const date = new Date(nowMs).toISOString().slice(0, 10);
  return `bidstack:ai:daily:${orgId}:${userId}:${date}`;
}

export function dailySessionKey(orgId: string, userId: string, nowMs = Date.now()): string {
  const date = new Date(nowMs).toISOString().slice(0, 10);
  return `bidstack:ai:sessions:${orgId}:${userId}:${date}`;
}

// ─── Types ────────────────────────────────────────────────────────────────

export interface AiCapCheckResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  reason?: string;
}

export interface EmailDraftInput {
  orgId: string;
  userId: string;
  contactId?: string;
  dealId?: string;
  tone: 'formal' | 'friendly' | 'direct';
  intent: string;
}

export interface EmailDraft {
  subject: string;
  body: string;
}

export interface EmailDraftResult {
  sessionId: string;
  drafts: [EmailDraft, EmailDraft, EmailDraft];
  costMicros: number;
}

export interface DealSentimentResult {
  sessionId: string;
  score: number; // -1 to 1
  label: 'positive' | 'neutral' | 'negative';
  summary: string;
  riskFlags: string[];
  suggestedActions: string[];
  costMicros: number;
}

export interface MeetingPrepResult {
  sessionId: string;
  attendees: Array<{ name: string; role: string | null; company: string | null }>;
  openOpps: Array<{ id: string; title: string; stage: string }>;
  recentInteractions: string[];
  talkingPoints: string[];
  suggestedQuestions: string[];
  costMicros: number;
}

export interface ContactEnrichResult {
  sessionId: string;
  jobTitle: string | null;
  company: string | null;
  linkedinUrl: string | null;
  seniority: string | null;
  source: 'apollo' | 'domain-inference' | 'none';
  costMicros: number;
}

export interface AccountIntelResult {
  sessionId: string;
  healthScore: number; // 0–100
  summary: string;
  expansionOpportunities: string[];
  churnRisks: string[];
  costMicros: number;
}

// ─── Cap enforcement ──────────────────────────────────────────────────────

export async function checkDailyCap(
  orgId: string,
  userId: string,
  log: PinoLogger,
): Promise<AiCapCheckResult> {
  // Fetch org cap (may be absent for new orgs — fallback to default).
  let capMicros = DEFAULT_DAILY_CAP_MICROS;
  try {
    const settings = await prisma.orgSettings.findUnique({ where: { orgId } });
    if (settings) {
      const raw = settings.aiCostCapDailyMicros as bigint;
      // 0 = unlimited
      if (raw === 0n) return { allowed: true };
      capMicros = raw;
    }
  } catch (err) {
    log.warn({ err }, 'ai-assistant: failed to fetch org settings, using default cap');
  }

  const nowMs = Date.now();
  const costKey = dailyCostKey(orgId, userId, nowMs);
  const sessionKey = dailySessionKey(orgId, userId, nowMs);

  try {
    const [costRaw, sessRaw] = await redis.mget(costKey, sessionKey);
    const costSoFar = BigInt(costRaw ?? '0');
    const sessionsSoFar = Number(sessRaw ?? '0');

    if (sessionsSoFar >= DEFAULT_DAILY_SESSION_CAP) {
      // Retry-after: seconds until next UTC midnight.
      const msUntilMidnight =
        new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime() +
        86_400_000 -
        nowMs;
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(msUntilMidnight / 1000),
        reason: `Daily AI session limit of ${DEFAULT_DAILY_SESSION_CAP} reached.`,
      };
    }

    if (costSoFar >= capMicros) {
      const msUntilMidnight =
        new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime() +
        86_400_000 -
        nowMs;
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(msUntilMidnight / 1000),
        reason: `Daily AI cost cap of $${Number(capMicros) / 1_000_000} reached.`,
      };
    }
  } catch (err) {
    // Fail open — Redis unreachable shouldn't block AI features, but log loudly.
    log.warn({ err }, 'ai-assistant: Redis cap check failed, allowing request (fail-open)');
  }

  return { allowed: true };
}

export async function recordCost(
  orgId: string,
  userId: string,
  costMicros: bigint,
  log: PinoLogger,
): Promise<void> {
  const nowMs = Date.now();
  const costKey = dailyCostKey(orgId, userId, nowMs);
  const sessionKey = dailySessionKey(orgId, userId, nowMs);
  const TTL_S = 48 * 60 * 60; // 48 h to outlive the UTC-day window
  try {
    const pipeline = redis.pipeline();
    pipeline.incrby(costKey, Number(costMicros)); // incrby works on string-int
    pipeline.expire(costKey, TTL_S);
    pipeline.incr(sessionKey);
    pipeline.expire(sessionKey, TTL_S);
    await pipeline.exec();
  } catch (err) {
    log.warn({ err }, 'ai-assistant: failed to persist cost to Redis');
  }
}

// ─── Prompt sanitisation ──────────────────────────────────────────────────

/**
 * Redact personal fields if the contact has opted out of AI processing.
 * WHY: spec requires no PII in prompts unless explicitly authorised per contact.
 */
export function sanitiseContactForPrompt(contact: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  aiOptOut: boolean;
}): { id: string; name: string; email: string | null; phone: string | null; role: string | null } {
  if (contact.aiOptOut) {
    return { id: contact.id, name: '[REDACTED]', email: null, phone: null, role: contact.role };
  }
  return contact;
}

// ─── Dust client factory ──────────────────────────────────────────────────

export function buildDustClient(log: PinoLogger): DustClient | null {
  const apiKey = process.env.DUST_API_KEY;
  const workspaceId = process.env.DUST_WORKSPACE_ID;
  if (!apiKey || !workspaceId) return null;
  return new DustClient({
    apiKey,
    workspaceId,
    baseUrl: process.env.DUST_BASE_URL,
    timeoutMs: 30_000,
    logger: log,
  });
}

// ─── Cost estimation ──────────────────────────────────────────────────────

export function estimateCost(inputTokens: number, outputTokens: number): bigint {
  return (
    BigInt(inputTokens) * COST_PER_TOKEN_INPUT_MICROS +
    BigInt(outputTokens) * COST_PER_TOKEN_OUTPUT_MICROS
  );
}

// ─── Session persistence helper ───────────────────────────────────────────

export async function persistSession(opts: {
  orgId: string;
  userId: string;
  kind: 'EMAIL_DRAFT' | 'DEAL_INSIGHT' | 'MEETING_PREP' | 'DATA_ENRICH' | 'SENTIMENT';
  entityType?: string;
  entityId?: string;
  prompt: string;
  response: string;
  tokenInput: number;
  tokenOutput: number;
  costMicros: bigint;
}): Promise<string> {
  const session = await prisma.aiAssistantSession.create({
    data: {
      orgId: opts.orgId,
      userId: opts.userId,
      kind: opts.kind,
      entityType: opts.entityType,
      entityId: opts.entityId,
      prompt: opts.prompt,
      response: opts.response,
      tokenInput: opts.tokenInput,
      tokenOutput: opts.tokenOutput,
      costMicros: opts.costMicros,
      model: AI_MODEL,
    },
    select: { id: true },
  });
  return session.id;
}
