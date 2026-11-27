# Meeting people unread is not none

**Problem:** The people behind a coverage cell said "Nobody at this level met" when the meeting list had not arrived, and again when a listed meeting's detail failed. Both payloads are empty. Neither one is a confirmed empty level.

**Diagnosis:** The drill treated `isLoading` as the only in-flight state. A paused read is pending and not fetching, so `isLoading` is false and `data` is missing. A failed detail query settles with no attendee payload, and `collectPeople` of that empty set is the same shape as a level where nobody was met.

**Fix:** In `PeopleDrill`, keep the loading line while the list or any detail is still pending. If the list errors, or every arrived detail failed and no person is confirmed, say the meetings could not be loaded. Say nobody only after a successful list with no matching people.

**Why it works:** "Nobody" now requires a read that finished. An unread list and a failed detail stay on the loading or error line.

**Prevention:** A meeting or calendar surface that says empty, none, or free must branch on pending and error before it treats a missing payload as a confirmed empty result.
