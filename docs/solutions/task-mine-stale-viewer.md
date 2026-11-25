# Mine follows the demo session address

## Evidence

Demo sign-in stores the visitor address next to the session token. Replacing that session does not always render a new auth snapshot, so a Mine cut that trusts the snapshot keeps the previous visitor's follow-ups. On the demo book that is the Siemens technical volume for the first address and the IKEA pricing annex for the second. The header also kept counting every loaded row as active.

## Correction

Mine reads the stored address only while a demo session token is present. An auth-fingerprint change re-reads it, so the previous person's rows drop without a reload. A leftover address with no token does not override the signed-in person. The Mine header counts those rows. A missing address matches nothing.

## Verification

`apps/web/src/components/task/task-mine-viewer.test.ts` pins the address rule. `apps/web/src/pages/TasksPage.mine-stale.test.tsx` renders the demo titles for a stale snapshot, a session swap, a leftover address, and a missing viewer.
