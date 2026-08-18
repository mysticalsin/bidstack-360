# Relay log - handoff ledger (append-only, one line each)

- 2026-06-13T18:13:31-04:00 - Codex - UX/UI premium audit complete; fixes + verification in `D:\BIDCRM\docs\audits\2026-06-13-ux-ui-premium-audit.md`; next: performance chunks + Vitest teardown noise.
- 2026-06-13T18:37:52-04:00 - Codex - Idle auth recovery + clean web gate complete; API forced token refresh, React Query focus/reconnect, and exchange-rate test teardown noise fixed; next: dedicated heavy-chunk perf pass.
- 2026-06-14 - Claude (Opus 4.8) - i18n sweep COMPLETE (rounds 4-26, 81.2% / 294-of-362, web suite 287/287); pushed all 50 commits demo -> origin/demo (HEAD f13be2d3); reconciled security #5-#17 (ISSUES.md right, BATON.bidcrm.md "open" stale — 5 real fixed in source, commit 3df6db8e); 14 Codex WIP files left uncommitted, never swept. next: finish i18n 100% after Codex commits WIP; Tony deps = MS Graph creds + db:migrate + key rotation.
2026-08-17 Claude(Opus5) | Amaris Bid Office finished: 5 gate bypasses closed, governance+Stage10 on the record, settings control, i18n x7. Gate green. 7 commits, unpushed.
2026-08-17 Claude(Opus5) | Cloudflare Workers AI first-class + UI card mounted (was never rendered); default llama-4-scout after live probe showed reasoning models return content:null; VERIFIED live end-to-end.
2026-08-18 Claude(Opus5) | Full-stack verification: worker started + read its log -> found 2 silent defects (dust.poll FK on deleted org; ai-audit retention regclass guard never ran). Both fixed+tested. Stack green.
2026-08-18 Claude(Opus5) | flex-1(basis 0) collapse: user found opp title 5x242px; swept 51 routes x 5 viewports, found+fixed 4 (opp header, calendar, TaskRow, KpiRow) + source-contract test.
