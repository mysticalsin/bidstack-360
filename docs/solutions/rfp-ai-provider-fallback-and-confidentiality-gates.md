# RFP AI Provider Fallback And Confidentiality Gates

## Problem

RFP automation uses multiple AI-capable systems: direct hosted providers such as NVIDIA NIM, Dust agents, local extraction/OCR, and deterministic fallback parsing. A failure in one tier must not silently produce fake output, and confidential Tier-D documents must not reach external parsing or model services.

## Pattern

1. Run confidentiality gates before extraction, OCR, OmniParse, provider calls, or Dust calls.
2. Treat direct providers, Dust, and deterministic fallback as separate tiers.
3. A failed direct provider should fall through to Dust when Dust is configured.
4. A Dust run is usable only when `status === 'succeeded'` and output is non-empty.
5. OpenAI-compatible hosted providers must return HTTP 200 and non-empty `choices[0].message.content`.
6. HTTP 202/pending or empty output is an error, not success.
7. Eval judges must coerce fenced JSON but schema-validate score ranges before trusting output.
8. Never log or commit provider API keys.

## Current Implementation

- Worker provider hardening: `apps/worker/src/lib/llm-provider.ts`
- RFP tiering wrapper: `apps/worker/src/lib/rfp-llm.ts`
- Requirement extraction gate: `apps/worker/src/queues/rfp-requirement-extract.processor.ts`
- Eval judge validation: `apps/api/src/evals/llm-judge.ts`
- Relay memory: `handoff/relay-baton/`

## Verification

- `pnpm --filter @bidstack/worker test -- src/lib/llm-provider.test.ts src/lib/rfp-llm.test.ts src/crew/dust-executor.test.ts src/queues/__tests__/rfp-review-crew.test.ts src/queues/__tests__/rfp-requirement-extract-gates.test.ts`
- `pnpm --filter @bidstack/api test -- src/evals/llm-judge.test.ts src/lib/crew-standard.test.ts`
- `pnpm --filter @bidstack/api typecheck`
- `pnpm --filter @bidstack/worker typecheck`
- `pnpm --filter @bidstack/api lint`
- `pnpm --filter @bidstack/worker lint`
