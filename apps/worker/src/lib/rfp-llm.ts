// Shared provider-selection + audit wrapper for every RFP AI step.
//
// One place decides which model answers an RFP step and records the AI-audit
// trail. Tiering:  direct LLM (RFP_LLM_PROVIDER env: OpenAI/Anthropic/Moonshot)
// → Dust agent (per-org / global workspace) → null. A null return means "no
// provider configured, or the call errored" — the caller then applies its own
// deterministic fallback (placeholder draft, zero QA score, PARTIAL compliance…).
//
// WHY a helper: requirement-extract, section-draft, qa-review, compliance-fill
// and the legal/review crew all ran the same Dust-or-fallback block. Centralising
// it means a new provider (or audit field) is wired once, not five times, and the
// fail-open contract is identical everywhere. The API key is never logged.

import type pino from 'pino';
import type { DustClient } from '@bidstack/dust-client';

import { logAiInvocation } from './ai-audit-worker.js';
import { resolveLlmFromEnv, completeChat } from './llm-provider.js';
import { resolveOrgLlm } from './org-llm.js';

export interface RfpCompletionOpts {
  orgId: string;
  log: pino.Logger;
  /** Dust client for the org, or null. Used only on the Dust tier. */
  dust: DustClient | null;
  /** Dust agent id for the Dust tier (ignored by direct providers). */
  agentId: string;
  /** Full prompt — role preamble + instructions + content (built by the caller). */
  userMessage: string;
  /** System prompt for direct chat providers (Dust uses the agent's own instructions). */
  system?: string;
  /** Audit label, e.g. 'rfp-qa-review'. */
  agentType: string;
  traceId?: string;
  /** Force JSON for direct chat providers (extract/QA/compliance); omit for Markdown steps. */
  responseFormat?: 'json_object' | 'text';
  /** Max output tokens for direct chat providers (Markdown drafts need more than the default). */
  maxTokens?: number;
  /** Cooperative cancellation from queue-backed jobs. */
  signal?: AbortSignal;
}

export interface RfpCompletionResult {
  text: string;
  /** 'openai' | 'anthropic' | 'moonshot' | 'nim' | 'gemma' | 'dust' */
  provider: string;
  /** Dust run id when the Dust tier answered; undefined otherwise. */
  runId?: string;
}

/**
 * Run one RFP completion against the configured provider. Returns null when no
 * provider is configured or the call failed (caller falls back deterministically).
 * Emits exactly one AI-audit record (success or error) for the attempt.
 */
export async function runRfpCompletion(
  opts: RfpCompletionOpts,
): Promise<RfpCompletionResult | null> {
  const {
    orgId,
    log,
    dust,
    agentId,
    userMessage,
    system,
    agentType,
    traceId,
    responseFormat,
    maxTokens,
    signal,
  } = opts;
  // Per-org provider (chosen in Settings) wins over the deployment-wide env
  // provider, so a tenant can switch vendors without a redeploy.
  const directLlm = (await resolveOrgLlm(orgId)) ?? resolveLlmFromEnv();

  // ── Tier 1: direct LLM provider (GPT / Claude / Kimi / NIM / Gemma) ──────────
  if (directLlm) {
    const t0 = Date.now();
    try {
      const text = await completeChat(directLlm, {
        system,
        user: userMessage,
        responseFormat,
        maxTokens,
        signal,
      });
      await logAiInvocation(
        {
          orgId,
          agentType,
          model: `${directLlm.kind}:${directLlm.model}`,
          prompt: userMessage,
          response: text,
          tokenCount: 0,
          durationMs: Date.now() - t0,
          status: 'success',
          traceId,
        },
        log,
      );
      return { text, provider: directLlm.kind };
    } catch (err) {
      if (signal?.aborted) throw err;
      log.warn(
        { err, provider: directLlm.kind, agentType },
        'rfp-llm: provider call failed, falling back',
      );
      await logAiInvocation(
        {
          orgId,
          agentType,
          model: `${directLlm.kind}:${directLlm.model}`,
          prompt: userMessage,
          response: '',
          tokenCount: 0,
          durationMs: Date.now() - t0,
          status: 'error',
          errorMsg: (err as Error).message?.slice(0, 500),
          traceId,
        },
        log,
      );
      // Continue to Dust when available. A transient hosted-model failure should
      // not skip an org-scoped Dust workspace that is already configured.
    }
  }

  // ── Tier 2: Dust agent (per-org or global workspace) ────────────────────────
  if (dust) {
    const t0 = Date.now();
    try {
      const run = await dust.runAgent(agentId, userMessage, { signal });
      const text = run.output?.trim() ?? '';
      if (run.status !== 'succeeded' || !text) {
        throw new Error(`Dust agent run failed: ${run.status}`);
      }
      await logAiInvocation(
        {
          orgId,
          agentType,
          model: 'dust',
          prompt: userMessage,
          response: text,
          tokenCount: 0,
          durationMs: Date.now() - t0,
          status: 'success',
          traceId,
        },
        log,
      );
      return { text, provider: 'dust', runId: run.run_id };
    } catch (err) {
      if (signal?.aborted) throw err;
      log.warn({ err, agentType }, 'rfp-llm: Dust call failed, falling back');
      await logAiInvocation(
        {
          orgId,
          agentType,
          model: 'dust',
          prompt: userMessage,
          response: '',
          tokenCount: 0,
          durationMs: Date.now() - t0,
          status: 'error',
          errorMsg: (err as Error).message?.slice(0, 500),
          traceId,
        },
        log,
      );
      return null;
    }
  }

  // ── Tier 3: nothing configured ──────────────────────────────────────────────
  return null;
}
