# The tasks list names who owns the follow-up

## Evidence

Demo follow-up "Submit revised pricing & SoW v2" is assigned to alex.example@example.test. The tasks list showed the title, the due date, and the status. The owner appeared only after opening the record. An unassigned follow-up has no owner to show.

## Correction

The row prints "Assigned to" plus the email already on the task. The line uses the secondary foreground so it stays readable on the card. No assignee leaves the line off. The list does not load a new field.

## Verification

`apps/web/src/components/task/TaskRow.owner.test.tsx` renders the demo pricing follow-up and expects the owner line, and renders the same follow-up with no assignee and expects no owner line.
