# MISTAKES — BidStack 360°

Per Tony's `mistakes-protocol.md`:
- Read this BEFORE every task
- Log EVERY mistake immediately (root cause, prevention rule, category)
- Never repeat a logged mistake — if a repeat is detected, HALT and escalate
- After completing a non-trivial fix, write a `docs/solutions/` entry for reuse

---

## Format

```
### [TIMESTAMP] CATEGORY: Short description
- **What went wrong:** ...
- **Root cause:** ...
- **Prevention rule:** ...
- **Files affected:** ...
```

Categories: BUG, ARCHITECTURE, SECURITY, PERFORMANCE, UX, TESTING, INFRA, PROCESS.

---

## Ledger

<!-- New entries appended at the top of this section. -->

### 2026-05-10 PROCESS: Master prompt assumed React 19 + Twenty fork as base
- **What went wrong:** Initial framing assumed Twenty CRM uses React 19 and has a stable `ApplicationRegistration` marketplace contract; both turned out to be wrong (React 18.2.39, marketplace WIP, registry path 404).
- **Root cause:** Trusted prose specs without verifying against upstream code.
- **Prevention rule:** Before committing to a fork/extension architecture, spawn an Explore agent to verify the actual upstream tech stack and extension-point contracts. Treat any prose claim about an upstream's internals as a hypothesis until grepped.
- **Files affected:** SPEC.md (architecture decision documented as standalone-first, Twenty overlay preserved for future).
