/**
 * AI invocation audit log.
 *
 * WHY: EU AI Act Art. 50 requires transparency logging for AI-assisted decisions.
 * GDPR Art. 22 requires human oversight of automated decision-making.
 * 90-day retention enforced by scheduled cleanup job (rfp.audit-cleanup).
 *
 * Security: prompts are hashed (SHA-256), not stored in full.
 * Only first 200 chars of prompt/response snippets are kept, stripped of PII.
 */

import crypto from 'node:crypto';
import { prisma } from '@bidstack/db';
import { createLogger } from './logger.js';

const log = createLogger({ name: 'ai-audit' });

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

export async function logAiInvocation(input: AiInvocationInput): Promise<void> {
  try {
    // WHY raw INSERT: AiInvocation model is in the Prisma schema (Wave 9) but the
    // generated client hasn't been regenerated yet — the .dll is locked by the
    // running API server on Windows. Raw SQL is fully safe here since all values
    // are parameterized and we control every field. Migrate to prisma.aiInvocation.create
    // after the next pnpm db:generate run.
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
    // Audit log failure must NOT block the main flow — log and continue.
    // WHY: availability > auditability for the primary pipeline; a missing
    // audit record is recoverable from logs; a blocked pipeline is not.
    log.error(
      { err, orgId: input.orgId, agentType: input.agentType },
      'ai-audit write failed — non-fatal',
    );
  }
}
