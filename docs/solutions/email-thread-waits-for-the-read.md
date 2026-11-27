# Email thread waits for the read

**Problem:** Opening a thread runs before `GET /api/email/threads/:id` returns. A paused read has `data === undefined` and `isLoading` false. The view said Could not load this thread. An in-flight read showed only a skeleton. A failed status with `isError` still false kept a stale message. A settled null payload used the same failed sentence.

**Diagnosis:** The view treated `isLoading` false plus a missing payload as a failure (`isError || !data`). React Query can leave `data` undefined while `isLoading` is false, on a pause and on a slow read. `isError` hid a stale message, but a status of error with `isError` still false did not.

**Fix:** `emailThreadPhase` in `apps/web/src/components/email/email-thread-read.ts` reports `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Anything else is ready. `EmailThreadView.tsx` uses that phase. Unread says the thread has not arrived. Failed says Could not load this thread and does not keep a stale message. A settled null payload stays an empty thread. A settled thread with no messages stays empty. A message that arrived still shows, including a blank body.

**Why it works:** Empty is only for a payload that arrived. A missing payload is still in progress. A failure is not a settled miss and it is not the previous message.

**Prevention:** `EmailThreadView.read.test.tsx` covers a paused read, an in-flight read with `isLoading` false, an in-flight read that used to be only a skeleton, a failed read, a failed read with a stale message, a failed status while `isError` is still false, a settled null payload, a settled thread with no messages, a loaded message, and a message with a blank body.
