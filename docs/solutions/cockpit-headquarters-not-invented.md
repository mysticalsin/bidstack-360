# Cockpit headquarters is not inferred from the name

## Problem

The account cockpit business snapshot printed a headquarters city from a
hardcoded name dictionary. Demo accounts such as DNB Bank showed "Oslo,
Norway" with a "Derived" badge. The match was a substring, so a name
containing "nos" showed Lisbon and a name containing "rush" showed Chicago.
The cockpit company record has no headquarters field, so the city was not
observed.

## Solution

The headquarters row says "Not verified" and uses the missing-source badge
until a headquarters source is attached to the record. The name dictionary
is gone.

## Verification

- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/BusinessSnapshotCard.test.tsx`
