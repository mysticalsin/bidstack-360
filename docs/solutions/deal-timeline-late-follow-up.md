# Deal timeline late follow-up

**Problem:** The deal activity tab rendered a task as "Task created: …" and
left the due day in metadata. Demo follow-ups due in May 2026 and still open
read as ordinary history, and the title did not open the task.

**Fix:** An open, in-progress, or blocked task whose UTC due day is before
today shows `Overdue: Nd late.` in the row text. Due today, a future day, a
finished follow-up, and a missing date stay on the original sentence. A task
row links to `/tasks/<id>`. Calls and other kinds stay text. The route sends
the due day as an ISO string.

**Do not:** call a finished follow-up late, or treat due today as late. Do
not link non-task timeline rows.
