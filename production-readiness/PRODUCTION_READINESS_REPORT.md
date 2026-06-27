# BidStack 360° — Production Readiness Report

**Date:** 2026-06-27 · **Branch:** feat/prod-hardening-mantu
**Method:** Evidence-based review. Unverified = UNKNOWN/FAIL, never assumed PASS. Live infrastructure was not accessible to this review.

---

## 1. Verdict: **NOT READY**

Not because of application defects — the code-side security and correctness are genuinely strong — but because the **operational release gates cannot be PASSed without infrastructure access and authorized testing**, and per the gate rules an untested backup/restore, unverified live IAM/network, unmeasured load behavior, and an intermittently-flaky test suite are blockers.

This is **READY-pending-operational-verification**: most remaining work is *proving* things in the live environment (backup restore drill, load test, IAM/TLS/bucket review, container + CI scans, monitoring/alert validation), plus 3 decisions only you can make.

## 2. Top risks (highest first)
1. **No tested backups / restore (CRITICAL, Gate 12).** Backups may exist via infra but no restore drill has been run. For an app holding customer + PII data this is the #1 blocker.
2. **Live infra/IAM/network unverified (HIGH, Gate 6).** No review of cloud IAM least-privilege, public-bucket/DB exposure, DNS/TLS, firewall rules. Code sets correct security headers; the live posture is unknown.
3. **PII-at-rest encryption prod status unknown (HIGH, Gate 5/13).** `PII_FIELD_ENCRYPTION` defaults `false`; if not enabled in prod, Contact/Lead/User email+phone are plaintext at rest. (Also: the SMS-field encryption path shipped in *unverified swarm WIP*, now quarantined — see §6.)
4. **Performance under load unmeasured (HIGH, Gate 10).** k6 scripts exist but no load/stress/soak run; SLOs not validated.
5. **Supply-chain / CI gates unverified (HIGH, Gate 8).** SAST/SCA/secret-scan/container-scan scripts exist but weren't run/reviewed; branch protection unverified.
6. **Test suite not reliably green (MED, Gate 9).** Intermittent cross-file flakiness; 39 integration tests share one DB org.

## 3. What was fixed (this session — 17 verified commits)
- **2 real production bugs:** lead-convert + CSV import 400 (unbounded query → query-guard reject) `7c34c770`; cross-tenant `references.companyId` leak `208efe0e`.
- **Security hardening:** 6 missing authZ write-gates `20a72e6e`; DNS-rebind SSRF guard + dev carve-out `61e0d9dd`/`00bebc0b`; defense-in-depth (token select, join org-filter, activity scope) `0dd353d8`.
- **Reliability:** test-suite global-leak fix `f08a9ed1`.
- **Feature work landed green:** F8 forecasts, integration-test isolation, cross-sell atomic writes, settings RBAC.
- **Quarantined** ~50 files of unverified, ultrareview-flagged swarm WIP (PII-enc + queue-fairness) into `stash@{0}` + patch — kept out of the verified branch.

## 4. What was tested / verified
- typecheck (all packages) ✅ · production build ✅ · MCP server (54 tests) ✅ · full api suite green this run (with a documented flakiness caveat).
- 4-dimension read-only security audit (multi-tenancy, authZ/IDOR, injection/SSRF, secret/PII) — see `docs/audits/SECURITY_AUDIT_2026-06-27.md`.
- `/ultrareview` independent cloud review — 3 findings triaged (1 fixed, 2 were in quarantined swarm WIP).

## 5. Evidence index
- `production-readiness/RELEASE_GATE_MATRIX.md` — per-gate status + evidence.
- `docs/audits/SECURITY_AUDIT_2026-06-27.md` — security findings + fixes.
- `docs/qa/flaky-suite-2026-06-27.md` — test reliability gap + fix-plan.
- `docs/security/THREAT-MODEL.md` — threat model (pre-existing, 33K).
- Commits `7c34c770`,`208efe0e`,`20a72e6e`,`61e0d9dd`,`00bebc0b`,`0dd353d8`,`f08a9ed1` (+ feature commits).
- `git stash@{0}` + `scratchpad/swarm-wip-batch2-2026-06-27.patch` — quarantined swarm WIP.

## 6. Remaining findings / open items
- **Operational gates UNKNOWN/FAIL:** backups/restore, live IAM/network/TLS, container scan, CI/supply-chain, load/performance, observability runtime — all need infra access (§7).
- **Test hermeticity:** 39 shared-org integration tests → isolated-org migration (needs a seed-shape decision). Documented.
- **Apple-UX + accessibility:** Gate 3 unverified — needs a dev-stack/browser session.
- **Swarm WIP decision:** keep+review-and-land (PII-at-rest encryption, per-org queue fairness) or drop. The ultrareview found real bugs in it (SMS `VarChar(32)` overflow; missing committed module).

## 7. Required human approvals / access (to close the gates)
1. **Cloud + CI access** (read at minimum) + an **authorized-testing scope** (domains, accounts, environments) — unblocks Gates 6, 7, 8, 10.
2. **Run a backup restore drill** in staging (or confirm one) — unblocks Gate 12 (CRITICAL).
3. **Confirm `PII_FIELD_ENCRYPTION=true` + master key in prod** (after `scripts/encrypt-existing-pii.ts`) — unblocks Gate 5/13.
4. **Decision: keep or drop the stashed swarm features** (PII-at-rest, queue-fairness).
5. **Legal/security sign-off** for any compliance claim (Gate 13 is an evidence package only).

## 8. 30 / 60 / 90-day hardening plan
**0–30 (blockers):** restore + rollback drills (RTO/RPO); run load test at expected traffic; live IAM/network/TLS/bucket review; container + SAST/SCA/secret CI scans; confirm PII-encryption prod posture; land the test-hermeticity pass (reliably green).
**30–60 (HIGH/MED):** formalize role×object authZ matrix + contract tests; accessibility (WCAG 2.2 AA) + browser E2E; observability dashboards/alerts validated (trigger test alerts); RLS/Prisma-extension backstop ADR (fail-closed tenant scoping).
**60–90 (hardening):** SBOM + artifact provenance; DR tabletop; vendor/subprocessor review; web unit-test coverage uplift; Apple-UX polish; soak tests + capacity plan.
