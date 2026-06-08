# Relay Baton

Shared handoff memory for Claude, Gemini, Codex, and any future AI worker on BidStack 360.

## Read Order

1. `AGENTS.md`
2. `MISTAKES.md`
3. `PROGRESS.md`
4. `handoff/relay-baton/CURRENT_BATON.md`
5. `handoff/relay-baton/issues/ISSUE_REGISTER.md`
6. `handoff/relay-baton/lessons/LESSONS.md`

## Rules

- Never write secrets, `.env` values, raw tokens, or private customer text here.
- Keep the baton one screen where possible.
- Update `CURRENT_BATON.md` before ending a shift.
- Add every meaningful finding to `issues/ISSUE_REGISTER.md`.
- When an issue is fixed, mark it `resolved`, add verification evidence, and link the changed files.
- Add durable process lessons to `lessons/LESSONS.md`.
- If a lesson is a repeated mistake, also update `MISTAKES.md`.
- If a lesson is a reusable engineering pattern, also add a focused `docs/solutions/` entry.

## Checkpoint Format

```text
Done:      <verified work>
Now:       <current action or none>
Next:      <next exact command or patch>
Surfaced:  <blockers, risks, or none>
```
