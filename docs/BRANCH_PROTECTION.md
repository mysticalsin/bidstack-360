# Branch protection: `main`

`main` is the only integration branch. All product work lands on `main` through
a pull request. Direct pushes, force-pushes, and branch deletion are blocked
once the rules below are applied.

This repo's GitHub App token cannot write repository administration. A
maintainer with admin access must apply the settings (UI or API) after `main`
exists.

## Required GitHub settings

Repository → Settings → Branches → Add branch protection rule (or Ruleset)
targeting `main`:

1. Require a pull request before merging
   - Require 1 approving review (raise to 2 when a second reviewer exists)
   - Dismiss stale reviews on new commits
   - Do not allow bypassing for administrators unless you are mid-incident
2. Require status checks to pass before merging, and require branches to be
   up to date
   - `Unit (typecheck + lint + test + build + bundle guard)`
   - `Full-tree secret scan`
   - `Integration (Postgres + Redis)`
   - `E2E smoke (Playwright)`
   - `gitleaks secret scan`
3. Require conversation resolution before merging
4. Do not allow force pushes
5. Do not allow deletions
6. Restrict who can push to matching branches: nobody except the merge queue /
   GitHub UI merge button (no personal tokens)

Optional but recommended:

- Enable "Automatically delete head branches" after merge
- Dependabot already targets `main` (`.github/dependabot.yml`)
- Restrict merge methods to squash (keeps `main` linear)

## Apply via `gh` (admin token)

```bash
gh api -X PUT repos/mysticalsin/bidstack-360/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f required_pull_request_reviews[required_approving_review_count]=1 \
  -F required_pull_request_reviews[dismiss_stale_reviews]=true \
  -F required_status_checks[strict]=true \
  -f required_status_checks[contexts][]='Unit (typecheck + lint + test + build + bundle guard)' \
  -f required_status_checks[contexts][]='Full-tree secret scan' \
  -f required_status_checks[contexts][]='Integration (Postgres + Redis)' \
  -f required_status_checks[contexts][]='E2E smoke (Playwright)' \
  -f required_status_checks[contexts][]='gitleaks secret scan' \
  -F enforce_admins=true \
  -F restrictions= \
  -F allow_force_pushes=false \
  -F allow_deletions=false \
  -F required_conversation_resolution=true
```

Then set the default branch if it is not already `main`:

```bash
gh api -X PATCH repos/mysticalsin/bidstack-360 -f default_branch=main
```

## External deploy trackers

GitHub Actions deploy (`/.github/workflows/deploy.yml`) now fires on `main`.
Railway and Vercel production branch settings, if they still say `demo`, must
be pointed at `main` in those dashboards or deploys will stop after `demo` is
removed.

## Working agreement

- Feature branches are short-lived. Name them `cursor/…`, `feat/…`, or
  `fix/…` and delete them after merge.
- Do not open PRs against archived branches. Tags `archive/<old-branch>` keep
  the old tips; they are not integration targets.
- Major dependency upgrades stay in their own PR and must keep CI green.
  Dependabot groups minor and patch updates.
