# Consulting partner reference copy

## Problem

Fixture consulting-partner notes were titled "Sample: …". The section badge
said Sample. Fixture evidence was labelled "Sample data". An account with no
partners said "No consulting partners found". A seller reading the account
was told the product was still a demo.

## Solution

A row with `sample: true` is labelled **Reference**. Fixture note titles start
with "Reference:". Fixture evidence says "Reference record". An account with
no partners says "No consulting partners on file."

The fixture flag stays `sample: true`. Public fixture drafts stay
`source: 'fixture'`. Seed rows are not marked live.

## Why it works

A production CRM names a reference record and an empty list. It does not
describe the workspace as a sample, and it does not present fixture notes as
live account notes.

## Prevention

Customer-facing section copy lives in
`apps/web/src/components/consulting-partners/reference-copy.ts`. The fixture
source label lives on `PARTNER_SOURCE_LABEL.fixture`. Do not put "Sample",
"demo", "sandbox", "illustrative", or "not live" back on the note titles, the
badge, the source label, or the empty line.
