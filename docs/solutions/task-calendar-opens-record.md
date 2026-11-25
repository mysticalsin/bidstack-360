# A calendar follow-up opens its record

## Evidence

The task calendar chip linked to `/tasks?search=<title>`. The tasks page only reads `filter`, `sort`, and `view`. Choosing "Submit revised pricing & SoW v2" left the calendar and showed the unfiltered list. The command palette used the same search URL for a task hit.

## Correction

The chip and the palette task hit open `/tasks/<id>`. The list search is not a task address. The chip keeps a visible focus ring.

## Verification

`TaskCalendar.test.tsx` renders the May 2026 demo follow-up and asserts the link href is the record, not a search.
