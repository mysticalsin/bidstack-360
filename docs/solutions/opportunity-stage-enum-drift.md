# Opportunity Stage Enum Drift

## Problem

The API can return `500` on dashboard/accounts when PostgreSQL still has the prototype `opportunity_stage` enum labels (`discovery`, `qualified`, `proposal`, `negotiation`) while Prisma and shared schemas expect the canonical bid pipeline (`s1_lead`, `s1_ongoing`, `s2_sent`, `s3_technical_iteration`, `s4_negotiation`, `closed_won`, `closed_lost`).

## Fix

Confirm the database labels first:

```sql
select enumlabel
from pg_enum e
join pg_type t on t.oid = e.enumtypid
where t.typname = 'opportunity_stage'
order by e.enumsortorder;
```

For local development databases, rename labels in place so existing rows move with the enum value:

- `discovery` -> `s1_lead`
- `qualified` -> `s1_ongoing`
- `proposal` -> `s2_sent`
- `negotiation` -> `s4_negotiation`
- add missing `s3_technical_iteration`

Do not use a blind Prisma diff if it includes unrelated drops. In this repo, a full diff also tried to drop unrelated RFP/Hermes tables, so the safe path was a targeted enum repair.

## Verification

- `GET /api/crm/dashboard` returns `200`.
- `GET /api/crm/summary` returns `200`.
- `GET /api/tasks` returns `200`.
- `GET /api/opportunities/count` returns `200`.
- Re-run account/dashboard E2E after the API data endpoints are healthy.
