# Email list waits for the read

**Problem:** The mailbox panel opens before the thread list returns. A paused read has `isLoading` false and no pages. The panel said there was no email yet. An in-flight read did the same. A failed status with `isError` still false kept a stale thread.

**Diagnosis:** The panel treated `isLoading` false as settled. React Query can leave `data` undefined while `isLoading` is false, on a pause and on a slow read. `list.data?.pages` then became an empty thread list. `isError` hid a stale thread, but a status of error with `isError` still false did not.

**Fix:** `emailListPhase` in `apps/web/src/components/email/email-list-read.ts` reports `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Anything else is ready. `EmailPanel.tsx` uses that phase for the mailbox list. Unread says the list has not arrived. Failed says Could not load email and does not keep a stale thread. A settled null payload stays empty. A settled empty list stays empty. A loaded thread stays, including a blank subject.

**Why it works:** Empty is only for a payload that arrived. A missing payload is still in progress. A failure is not a settled miss and it is not the previous thread.

**Prevention:** `EmailPanel.read.test.tsx` covers a paused read, an in-flight read, a failed read, a failed read with stale data, a failed status while `isError` is still false, a settled null payload, a settled empty list, a loaded thread with a blank subject, and a loaded thread.
