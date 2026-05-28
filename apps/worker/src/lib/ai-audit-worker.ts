/**
 * AI invocation audit log — local copy for apps/worker.
 *
 * WHY: apps/worker cannot import from apps/api. This is a functional mirror of
 * apps/api/src/lib/ai-audit.ts. If the API version changes, update both.
 *
 * EU AI Act Art. 50: transparency logging for AI-assisted decisions.
 * GDPR Art. 22: human oversight of automated decision-making.
 * 90-day retention enforced by scheduled cleanup job (rfp.audit-cleanup).
 *
 * Security: prompts are hashed (SHA-256), NEVER stored in full.
 * Only first 200 chars of prompt/response snippets kept, stripped of PII.
 *
 * WHY raw SQL: AiInvocation is a Wave 9 model — Prisma client hasn't been
 * regenerated yet due to the Windows DLL lock. All values are parameterized.
 */

import crypto from 'node:crypto';
import type pino from 'pino';
import { prisma } from '@bidstack/db';

export interface AiInvocationInput {
  orgId: string;
  userId?: string;
  agentType: string;
  model: string;
  /** Full prompt text — hashed for storage, never stored in full */
  prompt: string;
  /** Full response text — hashed for storage, never stored in full */
  response: string;
  tokenCount: number;
  durationMs: number;
  status: 'success' | 'error' | 'timeout' | 'rejected';
  errorMsg?: string;
  traceId?: string;
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Strip potential PII from snippet: mask emails and phone-like patterns */
function sanitizeSnippet(text: string): string {
  return text
    .slice(0, 200)
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[EMAIL]')
    .replace(/\+?[0-9]{7,}/g, '[PHONE]');
}

export async function logAiInvocation(input: AiInvocationInput, log: pino.Logger): Promise<void> {
  try {
    await prisma.$executeRaw`
      INSERT INTO ai_invocations (
        id, org_id, user_id, agent_type, model,
        prompt_hash, prompt_snippet, response_hash, response_snippet,
        token_count, duration_ms, status, error_msg, trace_id, created_at
      ) VALUES (
        gen_random_uuid(),
        ${input.orgId}::uuid,
        ${input.userId ?? null}::uuid,
        ${input.agentType},
        ${input.model},
        ${sha256(input.prompt)},
        ${sanitizeSnippet(input.prompt)},
        ${sha256(input.response)},
        ${sanitizeSnippet(input.response)},
        ${input.tokenCount},
        ${input.durationMs},
        ${input.status},
        ${input.errorMsg ?? null},
        ${input.traceId ?? null},
        now()
      )
    `;
  } catch (err) {
    // WHY: audit log failure must NOT block the main pipeline flow — a missing
    // audit record is recoverable from logs; a blocked pipeline is not.
    log.error(
      { err, orgId: input.orgId, agentType: input.agentType },
      'ai-audit write failed — non-fatal',
    );
  }
}
