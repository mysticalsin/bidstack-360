# pnpm audit allowlist (dated, no-fix only)

**Dated:** 2026-11-02.
**Review by:** 2026-12-02.
**Mechanism:** `package.json` → `pnpm.auditConfig.ignoreGhsas`.

Use this list only when `pnpm audit --audit-level high` reports an advisory
with no patched release on the line the workspace actually runs. Prefer a
direct upgrade or `pnpm.overrides` whenever a patched version exists.

Do not add an entry to hide a fixable advisory.

## Current entries

| GHSA | CVE | Package | Found | Patched | Why no fix |
|------|-----|---------|-------|---------|------------|
| [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv) | CVE-2026-56876 | `extract-zip` | 2.0.1 | none (`<0.0.0`) | Latest published is 2.0.1. Pulled by Lighthouse → puppeteer-core → `@puppeteer/browsers`. Dev-only Chromium fetch path; no patched release. |
| [GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3) | CVE-2026-19693 | `extract-zip` | 2.0.1 | none (`<0.0.0`) | Same package and path as above. |
| [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | CVE-2023-54404 | `zod` | 3.25.76 | ≥4.6.6 | Advisory range is `<4.6.6`. Workspace apps stay on Zod 3 (`^3.24.1`; resolved 3.25.76). Latest Zod 3.x is 3.25.76 — no 3.x backport. Zod 4 is a breaking API change, not a drop-in patch. |

## Review rule

On or before 2026-12-02, re-run `pnpm audit --json --audit-level high` and
remove any GHSA that now has a patched version on our line (extract-zip 2.x
or a Zod 3 backport). If still unfixed, update the date and keep the entry.
