# Company note body

## Problem

The company Notes tab listed the title, the date, and the author, and dropped the body. On the demo seed the MAPFRE, DNB, and MAHLE notes are a single sentence each, so the tab had nothing to read.

## Solution

The company detail read selects `bodyMd` and the serializer copies it onto the note. The Notes tab prints that text under the title. A blank body adds no extra line. The text is a React text node, not HTML.

## Verification

- `apps/web` `CompanyTabs.notes.test.tsx`
- `apps/api` `company-note.test.ts`
