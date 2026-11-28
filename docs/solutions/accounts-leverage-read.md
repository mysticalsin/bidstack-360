# Accounts HEMA filter waits for the leverage read

## Problem

`/accounts?leverage=hema` filters the loaded dashboard snapshot by a second read, the MSA leverage list. Until that read returns, the id set is empty, so the page says the filter matched nothing and counts zero companies. A failed read stays on that empty sentence.

## Rule

A loading leverage read and a failed leverage read are not an empty filter. Say the read is loading, or that it failed and offer retry. Say the filter matched nothing only after a successful payload, including a successful empty list. A payload already on screen stays if a later refresh fails.

## Verification

- `pnpm --filter @bidstack/web exec vitest run src/pages/accountsPage/leverage-list-gate.test.ts src/pages/accountsPage/AccountsAllSegment.leverageRead.test.tsx src/pages/accountsPage/AccountsAllSegment.snapshotCap.test.tsx`
