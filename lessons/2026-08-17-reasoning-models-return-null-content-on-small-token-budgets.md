---
title: A reasoning model returns content:null on a small max_tokens — never make one the default, and never probe one with 16 tokens
date: 2026-08-17
project: BidStack 360° (D:\BIDCRM)
tags: [lessons, ai, llm, cloudflare, verification]
---

## Lesson — "the provider returned 200" is not "the provider answered"

**Rule (ALWAYS):** Before adopting a model as a default, call it **with the smallest
`max_tokens` your code actually uses** and assert on `message.content`, not on the HTTP
status. Reasoning models emit their chain-of-thought into `message.reasoning` *before*
`message.content`; on a small budget the trace consumes everything and `content` comes back
**null** with a perfectly healthy `200`.

**What happened:** Wiring Cloudflare Workers AI, I picked
`@cf/zai-org/glm-4.7-flash` as the default on documented facts alone — 131,072-token
context (Polo's `document-extract.ts` sends up to 80,000 characters in one prompt, so a
large window is genuinely required), function calling, Cloudflare-pinned. Reasonable, and
wrong.

Probing the live endpoint with the app's own connectivity-probe shape (`max_tokens: 16`):

```
@cf/zai-org/glm-4.7-flash                 http=200  content=NULL   reasoningLen=1489
@cf/meta/llama-3.3-70b-instruct-fp8-fast  http=200  content="OK"   reasoningLen=0
```

`completeChat` treats empty content as a failure:

```ts
if (!content.trim()) throw new Error(`${llm.kind} completion returned empty content`);
```

So the default model would have made **every short call fail into the deterministic stub**,
and the Settings → "Test" button would have reported a working, correctly-configured,
paid-for provider as **dead**. Both silently: HTTP 200 throughout, no error anywhere except
a copilot that quietly stopped being AI.

At `max_tokens: 512` the same model answers fine (`"Acme is requesting a 12-month data
platform build."` after a 1,489-character reasoning trace, in 7.7s vs 1.0s for a
non-reasoning peer).

**Root cause:** I chose on published specs (context window, feature flags) without
exercising the call path the code actually makes. The spec sheet cannot tell you where a
model puts its output.

**How to apply:**
- Default to a **non-reasoning** model. Encode it: `CloudflareModelInfo.reasoning?: boolean`,
  with a test asserting the default is both large-context AND `reasoning !== true`.
- Size connectivity probes for the worst-case model, not the best case. The probe was
  `maxTokens: 16`; it is now 512. A probe that fails on a healthy provider is worse than no
  probe — it sends people to debug a credential that was never broken.
- When a model can put text in a non-standard field, decide deliberately whether to read it.
  Here we do NOT read `reasoning` — a chain-of-thought is not an answer — so the fix is
  model choice plus budget, not a parser change.
- Probe every candidate across the shapes the app really uses: prose, `response_format:
  json_object`, and the smallest budget. `llama-3.3-70b` wraps JSON in a ```json fence,
  which only matters because `stripJsonFence`/`coerceJsonObject` already handle it — that is
  a thing you learn by running it, not by reading it.
