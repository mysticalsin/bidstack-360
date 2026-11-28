# Enterprise copy for company intel empties

## Problem

Company list intel, the technology stack, signals, and the account intel panels
told a seller the product was still a demo. Empty revenue said sources were
not connected. An empty stack said technology was not detected yet. Fixture
rows wore a Sample badge and a line about data seeded for the demo.

## Solution

When a value is missing, the sentence names the missing fact and the existing
provider that would fill it. A row whose stored source is `fixture` (and whose
`sample` flag stays true) is labelled **Reference** / **Reference record**.
That label is not a live provider name. Seed files are unchanged, including
stored titles that still start with `Sample:`. The screen strips that prefix
when it draws the row.

The reason code `not_connected` is unchanged. Only the words a person reads
moved.

## Why it works

A production CRM states what is absent and what reconnecting a source would
fill. It does not describe the workspace as a sandbox, and it does not present
a fixture row as a filing or a job board.

## Prevention

New customer-facing intel copy uses `REFERENCE_BADGE` and `REFERENCE_RECORD`
from `packages/shared/src/company-intel/presentation.ts`. Do not add a Sample
badge, a "not connected" gap sentence, or a "detected yet" empty state on
these surfaces. Agreements, the onboarding purge, org-chart placeholders, and
consulting-partner notes are outside this pattern.
