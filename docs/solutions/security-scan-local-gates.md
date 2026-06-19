# Security scan local gates

## Problem

Local security certification has two separate questions:

- Is the current working tree clean enough to ship?
- Did git history ever contain credential-shaped material that requires
  rotation or an intentional history rewrite?

Treating those as the same gate creates false confidence. A normal code patch
can clean the current tree, but it cannot erase old commits.

## Pattern

Use bounded local gates first:

- `pnpm audit` for dependency advisories.
- `bash scripts/check-secrets.sh --full` for tracked working-tree secret regexes.
- `git ls-files --others --exclude-standard` plus the same regex family for
  untracked source files.
- `gitleaks git --config=.gitleaks.toml --redact=100 --log-opts=--max-count=1 .`
  for a current commit snapshot.
- `gitleaks git --config=.gitleaks.toml --redact=100 .` for full
  history, reported as a rotation/history finding when it fails.
- `pnpm security:scan` for bounded Semgrep SAST over shipped source/config.
- `pnpm container:scan` for fixed CRITICAL/HIGH vulnerabilities in the local
  deploy images.

Avoid unbounded Dockerized scans over the whole checkout unless the tool is
configured to ignore generated dependency folders. In this repo,
`gitleaks --no-git` and broad Semgrep Docker scans can walk too much local state
and time out. If a scanner times out, inspect and stop its container/client
process before continuing.

## Semgrep runner

`scripts/run-semgrep-sast.mjs` creates a temporary mirror of selected
source/config files from `git ls-files --cached --others --exclude-standard`.
That includes current untracked source work, but excludes worktrees, generated
artifacts, screenshots, locale payloads, coverage, duplicate design copies, and
preserved `packages/twenty-bidstack` sources.

Default runner settings:

- Image: `semgrep/semgrep:1.165.0`
- Configs: `p/owasp-top-ten,p/javascript,p/typescript`
- Blocking severity: `ERROR`
- Default deploy evidence artifact:
  `deploy-evidence/semgrep-latest.json`
- Env overrides: `BIDSTACK_SEMGREP_IMAGE`, `BIDSTACK_SEMGREP_CONFIGS`,
  `BIDSTACK_SEMGREP_SEVERITIES`, `BIDSTACK_SEMGREP_REPORT`,
  `BIDSTACK_SEMGREP_KEEP_TEMP`

Use `pnpm deploy:evidence:semgrep` for the release evidence command. The older
`pnpm security:scan` command uses the same runner and now writes the same
default artifact.

Why `ERROR` only blocks locally: the broader warning sweep currently contains
reviewed framework false positives from Express-focused rules flagging Fastify
JSON `reply.send(...)`, plus an SSE CORS warning where the reflected value is
selected from a whitelist. Those warnings should remain visible during manual
security review, but the local hard gate blocks the high-confidence findings
first.

## 2026-06-17 findings

- Current tracked tree scanner: clean.
- Untracked regex sweep: clean for non-generated source artifacts.
- Current commit gitleaks snapshot: clean after replacing the tracked
  `.claude/settings.json` MCP key value with a placeholder.
- Secret evidence writer: current-tree/current-commit proof can run without a
  native Gitleaks install by falling back to
  `ghcr.io/gitleaks/gitleaks:v8.30.1` through Docker. The artifact records
  `runner: "docker"` and the image when fallback is used.
- Full git history gitleaks: still reports 11 redacted historical findings
  across 1187 commits.
- Bounded Semgrep ERROR gate: `pnpm security:scan` passed on 1381 mirrored
  source/config files, 35 blocking rules, and 0 findings.
- Container vulnerability gate: `pnpm container:scan` passed across API, web,
  worker, MCP, and migrate images with `CRITICAL:0 HIGH:0` for each.
- Semgrep led to real fixes: AES-GCM decryptors now specify a 16-byte
  `authTagLength`, and the Docker `migrate` target now sets a non-root user
  before `CMD`.
- Container scanning led to real fixes: Node runtime images remove global
  npm/Corepack/pnpm package-manager trees after install, the web nginx stage
  upgrades Alpine packages during build, and the web runtime now uses
  unprivileged nginx on container port `8080`.

## Required disposition

Do not publish or reuse any credential that appeared in history. Rotate/revoke
the tracked `.claude/settings.json` MCP key and any provider credentials matching
the historical findings. Only rewrite git history with explicit owner approval,
because it is a destructive repository operation that can disrupt every clone.

## Verification snapshot

- `pnpm audit`: pass, no known vulnerabilities.
- `bash scripts/check-secrets.sh --full`: pass, 1670 tracked files.
- Current gitleaks snapshot: pass, including a 2026-06-17 evidence-writer run
  through Docker fallback when native `gitleaks` was absent.
- `pnpm security:scan`: pass, 1381 source/config files mirrored, 0 ERROR
  findings.
- `pnpm container:scan`: pass, five deploy images scanned with fixed
  CRITICAL/HIGH vulnerabilities blocked.
- Full-history gitleaks: fails with 11 redacted historical findings; tracked as
  a launch-blocking security disposition item, not hidden as a code failure.

See also `docs/solutions/container-vulnerability-scan-gate.md` for the deploy
image scan policy and proof image IDs.

## 2026-06-19 modern token pattern expansion

The local scanner family now catches modern provider token shapes that the old
regex missed:

- OpenAI project/service-account style `sk-proj-*` and Anthropic `sk-ant-*`
  keys through the widened `sk-[A-Za-z0-9_-]{20,}` rule.
- GitHub fine-grained PATs: `github_pat_*`.
- Slack bot/app/user tokens: `xox[baprs]-*`.
- Google API keys: `AIza*`.
- Azure Storage connection strings containing `AccountKey=...`.

Updated surfaces:

- `scripts/check-secrets.sh` staged-diff and full-tree guard.
- `.claude/hooks/scan-secrets.sh` edit/write hook.
- `.gitleaks.toml` custom rules layered on top of gitleaks defaults.
- `scripts/write-secret-scan-evidence.mjs` untracked-source regex and selftest
  fixtures.
- `scripts/ops/deploy-checklist.sh` pre-deploy staged/tracked secret probe.

Verification:

- `pnpm deploy:evidence:secrets:selftest`: pass.
- `bash -n scripts/check-secrets.sh scripts/ops/deploy-checklist.sh .claude/hooks/scan-secrets.sh`:
  pass.
- `bash scripts/check-secrets.sh --full`: pass, 1670 tracked files.
- No-file fixture probes proved the staged-diff and deploy-checklist regexes
  match `sk-proj-*`, `sk-ant-*`, `github_pat_*`, Slack, Google, and Azure
  account-key examples.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `docker run --rm ... ghcr.io/gitleaks/gitleaks:v8.30.1 git --config=/repo/.gitleaks.toml --redact=100 --log-opts=--max-count=1 /repo`:
  pass, one commit scanned, no leaks found.
- `node --check scripts/write-secret-scan-evidence.mjs`: pass.
- `pnpm exec eslint scripts/write-secret-scan-evidence.mjs --no-warn-ignored --max-warnings=0`:
  pass.

## 2026-06-19 scanner selftest fixture hygiene

The secret evidence writer now keeps poisoned selftest fixtures source-safe. It
assembles modern token examples from string fragments at runtime, verifies those
assembled examples still match `SECRET_PATTERN`, and also asserts the writer's
own source file does not contain raw token-shaped literals.

Why: release evidence scans untracked source files before commit. While
`scripts/write-secret-scan-evidence.mjs` was untracked, its raw `sk-proj-*`,
`sk-ant-*`, `github_pat_*`, Slack, Google, and Azure fixture strings caused the
untracked scanner to fail on the scanner itself. Tracking the file later would
have caused the full-tree scanner to fail too.

Verification:

- `node scripts/write-secret-scan-evidence.mjs --selftest`: pass.
- `bash scripts/check-secrets.sh --full`: pass, 1670 tracked files.
- `pnpm deploy:evidence:secrets`: current tree and current commit clean; still
  correctly blocks on missing full-history disposition when no reviewer/owner
  evidence is supplied.
- `node scripts/write-secret-scan-evidence.mjs --run-full-history --reviewer codex-local-evidence`:
  full-history gitleaks reviewed 11 redacted historical findings and correctly
  blocked on missing rotated/revoked and owner-approved disposition evidence.
- `pnpm deploy:evidence:production`: now passes the current-tree/current-commit
  secret checks and full-history-reviewed check, while still blocking on the
  required human security-owner rotation/approval fields.
