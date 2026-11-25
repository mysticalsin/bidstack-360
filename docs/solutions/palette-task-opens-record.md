# A palette follow-up opens its record

## Evidence

The command palette sent a task hit to `/tasks?search=<title>`. The tasks list reads `filter`, `sort`, and `view`. It does not read `search`. Choosing "Submit revised pricing & SoW v2", a synthetic demo follow-up on OP-2041, left the palette on the unfiltered task list. The task row on the list already addresses `/tasks/<id>`.

## Correction

A local palette task hit opens `/tasks/<id>`. The title is not part of the address. A slash in the id stays inside one path segment.

## Verification

`task-record-path.test.ts` and `CommandPalette.task.test.tsx` render the demo follow-up and assert the address is the record, not a search.
