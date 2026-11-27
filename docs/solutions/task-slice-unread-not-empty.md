# An unread tasks list is not an empty book

## Evidence

Recent is the default order on Tasks. A paused read leaves `isLoading` false and no payload. The header said "0 active follow-ups." The status line said "0 task." The card said "Nothing on the bid clock." Calendar view drew a blank month. A failed read kept the error card and still counted zero. Export wrote a CSV with no rows.

## Correction

A pending or failed read says the follow-ups have not arrived. It does not count zero, and it does not draw the empty book or a blank month. Export stays disabled until a payload arrives. A payload that arrived empty still says zero. A follow-up that arrived still shows. The arrived count is still the loaded page length. Open-only captions stay on the drafts that already own that count.

## Verification

`task-slice-read.test.ts` refuses a count of 0 while the read is pending or failed, and still allows an arrived empty book. `TasksPage.slice-read.test.tsx` renders Recent, including calendar view, without the empty or zero sentences until the payload arrives.
