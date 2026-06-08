# Opportunity Briefs Must Be Grounded

## Problem

`POST /opportunities/:id/brief` returned a local stub that told the user to
configure Dust. That made a visible CRM action look functional while providing
no account-team value.

## Solution

Build the brief deterministically from CRM context:

- Opportunity stage, value, probability, deadline, industry, and update time.
- Bounded open tasks for the opportunity.
- Bounded account contacts with `aiOptOut` redaction.
- Bounded account notes.
- Explicit risk focus and next actions for sales, presales, finance, legal, and
  delivery review.

Return a stable model label such as `crm-grounded-v1` so frontend and QA can
detect regressions away from the grounded path.

## Prevention

Do not share one account filter object across different Prisma models unless
the fields are identical. In this CRM:

- `Contact` uses `customer`.
- `Note` uses legacy `accountId`.
- Both may also use `companyId`.

Add a route-level test for generated briefs. Pure builder tests are useful, but
they cannot catch model-specific Prisma filter mistakes.
