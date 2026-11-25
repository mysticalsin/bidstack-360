# Cockpit note stays after save

**Problem:** The account notes panel waited for the list query to reload after a save. On a demo account that page was still empty, so the panel said "No notes yet" under the note the save had just returned.

**Fix:** Keep the saved note on the list until the reloaded page includes its id. A later edit or delete of that held note updates the same row. Pinned notes from the server stay above it. Numeric meeting-import titles stay hidden.

**Why it works:** The save response is the note. The list query is a separate read and can still be the previous page.
