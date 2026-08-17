---
title: A registry whose lookup falls back to a default entry cannot tell you it is incomplete
date: 2026-08-17
project: BidStack 360° (D:\BIDCRM)
tags: [lessons, architecture, types, ai, providers]
---

## Lesson — make registries total, and never let a lookup miss degrade into a default

**Rule (ALWAYS):** When one list enumerates something the rest of the system also
enumerates (providers, statuses, entity kinds), express it as a `Record<Union, T>` so a
missing entry is a compile error. **NEVER** write `list.find(x => x.id === id) ?? list[0]` —
a lookup that silently substitutes a different entry converts "we forgot one" into "the
wrong one renders as if it were right".

**What happened:** Adding Cloudflare Workers AI as an LLM provider touched the shared
registry, both env resolvers, and the API routes — and `pnpm typecheck` stayed green the
whole way, because the web layer kept its own hand-written copy:

- `apps/web/src/hooks/useAgentProviderCredentials.ts` re-declared the provider union by
  hand, with a comment claiming it was "Kept in sync with DIRECT_AGENT_PROVIDERS". It was
  not, and being a pure type, nothing failed to compile when it drifted.
- `AgentProviderCredentialsCard.tsx` held a parallel `PROVIDERS` array with
  `providerMeta = PROVIDERS.find(...) ?? PROVIDERS[0]!`. The API serves its provider list
  from `DIRECT_AGENT_PROVIDERS`, so a provider the UI did not know about still rendered a
  row — labelled **"OmniRoute (free gateway)"** with OmniRoute's endpoint placeholder. Not
  a missing feature: a *mislabelled* one.

Worse, a scout of the same surface found the entire card
(`AgentProviderCredentialsCard`, 676 lines: credential storage, the active-provider switch,
the connectivity test) **was never mounted anywhere in the app**. It had a unit test, two
solution docs and a PROGRESS entry, and zero render sites. Every model provider — not just
the new one — was unreachable from the running product.

**Root cause:** two enumerations of the same set, one of them a type (erased, so drift is
invisible to the compiler) and one of them an array with a forgiving lookup. Neither could
report being wrong. And "the component exists and its tests pass" was treated as equivalent
to "the feature is reachable".

**How to apply:**
- Import the union from its source of truth; do not re-declare it. A type-only import is
  erased at build time, so this is safe even across a bundle boundary.
- Registry shape: `Record<Union, Meta>`, then derive any ordered array from it. Adding a
  member to the union now fails the build until the entry exists.
- If a lookup genuinely can miss, make it return `undefined` and handle it — never `?? [0]`.
- When a module must not enter a bundle (here `@bidstack/shared/llm` uses global `fetch`),
  split the *data* into a sibling module (`llm-catalog`) instead of duplicating it. One
  source of truth, two consumers, no client shipped to the browser.
- **Grep for a render site before believing a UI feature exists.** A component with a green
  unit test and no mount point is dead code that reads as shipped work.
