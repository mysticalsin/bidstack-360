# Strategic account totals wait for the page read

## Problem

Strategic Accounts sums the current page into "On this page" totals. Before that read returns, the page treats a missing payload as zero key accounts, zero pipeline, zero open deals, and zero contacts. A later refresh that fails replaces the accounts already on screen with the first-load error.

## Solution

Until a payload arrives, the page says it is loading key accounts and does not draw the totals or the empty-book sentence. A failed first read says it could not load key accounts. A payload already on screen stays if a later refresh fails, with retry for that same read.

## Verification

`pnpm --filter @bidstack/web exec vitest run src/pages/accountsPage/key-account-read-phase.test.ts src/pages/accountsPage/AccountsKeySegment.readSettle.test.tsx src/pages/accountsPage/AccountsKeySegment.pageScope.test.tsx`
