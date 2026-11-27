# Cockpit data trust does not score a placeholder receipt

## Problem

The account cockpit data-trust card averaged every source receipt into "Attribution confidence". Demo accounts with only a bid got a synthesized "External CRM opportunity/customer record" at 55%, and seeded enrichments such as CI Financial got "BidStack seed profile" at 87%. A recent company-row update also read as a fresh source fetch.

## Solution

Confidence and freshness use external receipts only. `external_crm`, `bidstack`, `bidstack_seed`, and `seed_verified_profile` stay off the score and off the receipt list. With none left, the card says "Not verified". A recorded source such as Apollo still counts, and a seed row beside it does not.

## Verification

`pnpm --filter @bidstack/web exec vitest run src/components/cockpit/DataTrustCard.test.tsx src/components/cockpit/data-trust-posture.test.ts`
