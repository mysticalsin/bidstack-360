# Watchdog signal reference copy

## Problem

Fixture account-watch events were stored as `Sample: <headline>` with the
rationale `Sample data. …`. The signals timeline, account pulse, portfolio
alerts, initiatives, and the watchdog feed then badged those rows Sample.
A seller reading the account was told the workspace was still a demo.

## Fix

Keep `sample: true`, `source: 'sample'`, and the upsert key
`(orgId, 'sample', sample:<slug>:<companyId>)`. Store the catalog headline
with no prefix. The rationale starts with `Reference record.` The badge says
Reference. The source line says `Reference record`.

`noDash` and `stripSamplePrefix` still drop an old `Sample:` prefix, so rows
written before this change stay readable. Live provider names are unchanged.
No news provider, API key, or fetch was added.

## Lesson

The fixture flag and the seller-facing word are different. `sample: true`
means the row was not fetched live. The screen says Reference.
