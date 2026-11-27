# Logged meetings fill the calendar day

**Problem:** Demo seed writes workshops as activities (`Landing zone scoping workshop`, one UTC day before the seed clock, 13:00). The calendar week only reads `calendar_events`. That Tuesday column is empty, and the agenda says there is nothing, while the account timeline has the meeting.

**Fix:** `GET /calendar/events` adds the caller's own meeting activities that overlap the window. A blank subject becomes `Meeting`, so the day does not grow an empty block. A meeting already stored as a calendar event is not copied. The card says `Logged meeting`, not Google or Microsoft. These rows are timed, not all-day.

**Do not:** treat a logged meeting as an all-day bar, or as a provider calendar. Do not copy calls or notes onto the grid.
