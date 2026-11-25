# Account wall sample technologies

Demo seeds store open-data technology stacks with `sample: true`. On the account
technology wall those names rendered with a source chip and a confidence
percent, so the fixture read as a detection. Edit copied the same rows into
the draft, and Save wrote them as the account override, which keeps the
fixture in place after a later check.

## Decision

- A sample technology on the wall wears a Sample mark. A recorded technology
  does not.
- Edit starts from the non-sample rows only.
- Save does nothing when that draft is unchanged, so a sample-only stack is
  not stored as the override.
- A technology the user adds is saved. The sample fixture is not included.

## Verification

`CompanyTechStackSection.test.tsx` fails while a sample row has no Sample mark,
and while an unchanged edit stores the fixture.
