# Solutions — compound engineering ledger

Per Tony's `architect-protocol.md`:

> After completing a non-trivial fix, write a `docs/solutions/` entry for reuse.
> Search `docs/solutions/` before every implementation (compound engineering).

This directory is the second half of the MISTAKES.md cycle. MISTAKES says
"this went wrong, here's the prevention rule." Solutions says "here's the
playbook the next person — or the next session — uses to skip the discovery
phase entirely."

## Format

```
# <short, searchable title>

**Problem:** one-paragraph symptom description.
**Diagnosis:** what we eventually realized.
**Fix:** the actual change, with file paths and minimal code.
**Why it works:** the underlying reason.
**Prevention:** the test or convention that keeps it from recurring.
```

## When to write one

- After a non-trivial bug fix that took > 30 minutes of investigation.
- After resolving a non-obvious infra issue (env loading, port conflict, etc.).
- After landing a pattern you'll want to copy into other code paths.

Don't write one for a typo or a one-line tweak. The bar is "would I want
this if I hit the symptom again in six months?".
