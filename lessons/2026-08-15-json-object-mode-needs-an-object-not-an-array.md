---
title: response_format json_object must pair with an object-shaped prompt, never a top-level array
date: 2026-08-15
project: BidStack 360° (D:\BIDCRM)
tags: [lessons, ai, llm, json]
---

## Lesson — json_object mode + "return a JSON array" = malformed output on strict providers

**Rule (ALWAYS):** When an LLM call sets `response_format: { type: 'json_object' }`, the prompt
must ask for a JSON **object** (e.g. `{"drafts":[…]}`), and the parser must read that object.
Never ask for a top-level array under json_object mode.

**What happened:** The email-draft copilot (`ai-assistant.email.service.ts`) forced
`response_format=json_object` but its prompt said `Return JSON array: [{"subject","body"}]`
and parsed `JSON.parse(text) as EmailDraft[]`. Strong hosted models tolerated the mismatch;
OmniRoute's free-tier models (deepseek/hy3) honored json_object strictly and emitted garbage
like `{", ": ""}`. The array parse failed → the service fell back to its `[Draft N]` stub with
an empty/malformed body — looking like "AI is broken" when the model had actually responded.

**Root cause:** `json_object` is a hard constraint that the top-level value be an object.
Asking for an array fights it; each provider resolves the conflict differently (some wrap,
some 400, some emit nonsense). The failure is silent because the caller degrades to a stub.

**How to apply:**
1. Grep AI services for `responseFormat: 'json_object'` and confirm each paired prompt asks for
   `{...}`, not `[...]`. Parse the object, then read its array field.
2. Make the parser tolerant: `Array.isArray(p) ? p : (p?.drafts ?? [])` so an old array-shaped
   response still works.
3. When "AI returns stub", check the *model's raw output* (persisted on the session row /
   `response` field) before assuming the provider failed — a 200 with unparseable JSON is a
   prompt/parse bug, not a provider outage.

**Related:** the copilot is powered by OmniRoute on Railway
(`RFP_LLM_PROVIDER=omniroute`, `OMNIROUTE_BASE_URL=http://omniroute.railway.internal:20128/v1`,
`OMNIROUTE_MODEL=auto`) — keyless, reachable over Railway private networking. `auto/best-free`
is dead (Felo/OpenCode); `auto` routes to a working free provider. Free tier 429s under burst →
graceful stub.
