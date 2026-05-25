# Trunk Discipline Plan — BidStack 360°

**Date drafted:** 2026-05-24
**Status:** Plan only — not executed. Execute when parallel sessions are idle and the working tree is clean (or stashed/worktreed).
**Goal:** Establish one canonical trunk and a PR workflow so future feature work converges instead of fanning out into 45+ unmerged branches.

> ## Read before executing
>
> At the time this was drafted: 45 active local branches, ~50 locked worktrees under `.claude/worktrees/`, no `main` branch, no remote (`git remote -v` is empty). All commits are by `Tony` from parallel sessions/agents. Working tree had 400 untracked + 51 modified files.
>
> **Do not execute any destructive step (rename, delete, archive) while another session is writing.** Run `git for-each-ref --sort=-committerdate refs/heads/ | head -10` first; if any branch has a commit in the last 5 min, wait.

---

## Phase 1 — Pick and rename the trunk (5 min)

The naming convention is unclear. Candidates for the canonical trunk:

| Branch | HEAD | Last commit | Pitch |
|---|---|---|---|
| `feat/wave5-final-polish` | `6f366510` | 5h ago | Name suggests intended integration target. Same commit as `wave4-integration-hub` — looks deliberately pinned as a base. |
| `feat/wave5-onboarding-complete` | `5e6ddab8` | 10 min ago | Most recently advanced. Includes k6 perf work that the audit credited. |
| New branch off most-merged ancestor | — | — | Fresh start. Harder to bootstrap. |

**Recommendation:** start with whichever sits at the highest merge-base across all wave5 branches. Check with:

```bash
for b in $(git branch --list 'feat/wave5-*' --format='%(refname:short)'); do
  echo "$b: $(git rev-list --count feat/wave5-final-polish..$b) ahead"
done
```

Then either rename (`git branch -m <chosen> main`) or branch fresh (`git checkout -b main <chosen>`).

**Don't delete the old name yet** — keep both pointing at the same commit until the convention is proven.

---

## Phase 2 — Drop the no-op branches (10 min)

These 6 branches sit at the same commit `6f366510` from 5h ago. They were probably created for parallel sessions that didn't commit:

- `feat/wave4-integration-hub`
- `feat/wave5-azure-sso`
- `feat/wave5-final-polish` (only delete if you chose another trunk in Phase 1)
- `feat/wave5-outlook-integration`
- `feat/wave5-slack-zapier`
- `feat/wave5-onboarding-complete` (if not chosen as trunk)

Verify each is contained in the new trunk:

```bash
for b in feat/wave4-integration-hub feat/wave5-azure-sso feat/wave5-outlook-integration feat/wave5-slack-zapier; do
  unique=$(git rev-list main..$b 2>/dev/null | wc -l)
  echo "$b: $unique unique commits"
done
```

If `unique == 0`, safe to `git branch -d $b`. Skip any with unique commits — those need a PR.

---

## Phase 3 — Catalog the remaining feature branches (20 min)

For each `feat/*` branch with unique commits relative to the new trunk, build a one-row entry:

```bash
mkdir -p docs/branch-convergence
{
  echo "| Branch | Ahead | Behind | Files | Last commit | Status |"
  echo "|---|---|---|---|---|---|"
  for b in $(git branch --list 'feat/*' --format='%(refname:short)'); do
    [ "$b" = "main" ] && continue
    ahead=$(git rev-list --count main..$b 2>/dev/null)
    behind=$(git rev-list --count $b..main 2>/dev/null)
    files=$(git diff --name-only main...$b 2>/dev/null | wc -l)
    last=$(git log -1 --format='%ar' $b 2>/dev/null)
    echo "| \`$b\` | $ahead | $behind | $files | $last | ? |"
  done
} > docs/branch-convergence/inventory.md
```

For each branch in the inventory, decide:
- **MERGE** — fast-forward or PR into `main`
- **REBASE** — needs rebase first (behind > 0 and conflicts likely)
- **DROP** — already obsolete, no unique value
- **ARCHIVE** — keep history but no future work (tag + delete)

---

## Phase 4 — Worktree hygiene (10 min)

`.claude/worktrees/` had ~50 locked agent worktrees. Most are stale.

```bash
git worktree list --porcelain | grep -E '^worktree|^branch|^locked'
```

For each worktree:
- If branch points at a commit already in `main`: `git worktree remove <path> --force`
- If branch has unique commits: catalog like Phase 3 first, decide MERGE/DROP, then remove the worktree
- If locked: `git worktree unlock <path>` first, then remove

There may be a hook or a CI step worth adding to prune worktrees older than N days automatically.

---

## Phase 5 — PR workflow setup (15 min, one-time)

Right now there's no remote and no PR mechanism. CI exists (`.github/workflows/ci.yml`) but only fires on push/PR to `main`, which doesn't exist locally. Two paths:

**(a) Local-only:** keep everything offline. Make `main` the merge target by convention. Use `git merge --no-ff feat/x` for every feature, and `pnpm -r typecheck && pnpm -r lint && pnpm -r test` as the manual gate. The CI workflow becomes dead code.

**(b) GitHub remote:** `gh repo create` + `git push -u origin main`. Then the existing CI fires on every PR. Required checks: `unit`, `integration`, `e2e`. Branch protection prevents direct pushes to `main`.

CLAUDE.md says "feature branches only — never edit on main/master." That implies the intent is (b). Recommend pushing to a private GitHub repo and turning on branch protection.

---

## Phase 6 — Document the workflow (10 min)

Add to `CLAUDE.md` (in Part 2 — Architecture):

> ## Branch workflow
>
> - Trunk: `main` (renamed from `feat/wave5-final-polish` on 2026-05-XX). Never edit directly.
> - Feature branches: `feat/<wave>-<topic>` or `fix/<topic>`. Branched from `main`, merged via PR.
> - PR requires: typecheck + lint + test + e2e green; one human review (or, in solo mode, a re-read after a coffee).
> - Stale branches: auto-archived after 14 days of no commits. Run `scripts/prune-branches.sh` weekly.
> - Worktrees: under `.claude/worktrees/`, prefixed with the agent or session ID. Auto-pruned with the same script.

Add a `scripts/prune-branches.sh` helper:

```bash
#!/usr/bin/env bash
set -euo pipefail
# Branches merged into main and older than 14 days are safe to delete.
git branch --merged main | grep -vE '^\*|main|HEAD' | while read b; do
  last=$(git log -1 --format='%cr' "$b")
  case "$last" in
    *weeks*|*months*|*years*) echo "Would delete: $b ($last)" ;;
  esac
done
```

---

## Total estimated effort

~70 min once parallel sessions are idle. The riskiest step is **Phase 3-4 catalog + decision-making** — it's mechanical but tedious, and conflict resolution on Phase 5's first merges will likely add another hour.

## What this plan does NOT do

- Doesn't retroactively merge existing branches (you chose "discipline going forward" over "consolidate now"). When you're ready to consolidate, the inventory from Phase 3 is the prerequisite.
- Doesn't touch the working tree. Phases 1-2 run from the current branch via `git branch -m` / `git branch -d` without checkout.
- Doesn't push to a remote without explicit confirmation.
