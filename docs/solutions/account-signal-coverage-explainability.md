# Account signal coverage explainability

## Problem

The Accounts page computed a coverage percentage and missing fields, but account
cards mostly showed only `Coverage X%`. That failed the backlog requirement that
Signal Coverage explain why the score is weak and what the user should do next.

## Fix

Keep the logic deterministic and local to the trusted list inputs:

- `present`: account list signals currently attached.
- `missing`: account list signals still absent.
- `reason`: short explanation, e.g. `Missing Industry, Tech stack, and FTE.`
- `nextAction`: first actionable remediation, e.g. `Assign an industry to
  unlock sector routing.`

Render the explanation directly on the account card below confidence/coverage:

- Warning treatment when anything is missing.
- Success treatment when all list signals are present.
- 44px minimum height and wrapping text so the card stays usable on narrow
  layouts.
- Accessible label that includes the account name, reason, and next action.

## Lesson

Coverage badges are not enough for CRM operations. Every score shown to users
should answer: what signal created this state, what is missing, and what action
will improve it.
