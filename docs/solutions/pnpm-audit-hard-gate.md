# pnpm audit hard gate (G4)

**Problem:** Unit CI ran `pnpm audit --audit-level high` with
`continue-on-error: true`, so high/critical advisories never blocked a
merge.

**Fix:** Drop `continue-on-error` on that step. The unit job fails when
`pnpm audit --audit-level high` exits non-zero.

**Do not:** restore `continue-on-error` to hide a new advisory. Remediate
or override the package, then keep the gate red until it is clean.
