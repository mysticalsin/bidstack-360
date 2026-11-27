# Accounts list sample technologies

## Problem

Demo seeds store open-data technology stacks with `sample: true`. The All
accounts card still printed those names as a detected stack. A screen reader
heard only "Open {name} customer cockpit", so the fixture was easy to treat
as evidence.

## Pattern

- `sample` stays true only when every sighting of that name is demo fixture data.
- A real detection clears it, even when a louder sample sighting exists.
- The card shows one Sample caption when every visible technology is sample.
- The card link name includes that caption, because the link's name replaces
  the names of its contents.
- The row still shows at most three technology names. Sample is a caption, not
  another technology.

## Verification

- `AccountCard.test.tsx` fails while a sample stack has no Sample caption.
- `accountUtils.test.ts` fails while a mixed sighting is not marked.
- Both pass after the caption. The three-name cap stays.
