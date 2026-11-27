# Cockpit funding does not recommend from a sample stack

## Problem

Demo accounts such as DNB Bank and MAPFRE store a sample technology stack (Microsoft 365, Microsoft Azure, Google Workspace). The account cockpit funding card treated those names as a detected vendor footprint and showed ECIF or Google PSF as Recommended. An empty stack read also fell through to the cockpit snapshot, which merged a canned Microsoft, AWS, and Google catalog, so an account with nothing on file was offered all three programs.

## Solution

Funding waits for this account's own stack read. Sample rows, and a snapshot marked sample, are not a co-funding signal. A recorded technology beside a sample row still counts. A loading or failed read does not borrow the cockpit snapshot.

## Verification

`pnpm --filter @bidstack/web exec vitest run src/components/cockpit/fundingEligibility.test.ts src/components/cockpit/FundingEligibilityCard.test.tsx`
