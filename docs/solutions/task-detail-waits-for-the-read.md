# Task detail waits for the read

**Problem:** Opening a task runs before `GET /api/tasks` returns. A paused read has `data === undefined` and `isLoading` false. The page said Task not found and that the task may have been deleted. An in-flight read showed only a skeleton. A failed status with `isError` still false kept a stale title.

**Diagnosis:** The page treated `isLoading` false plus a missing row as a deleted task (`!task` after `tasks.data?.items`). React Query can leave `data` undefined while `isLoading` is false, on a pause and on a slow read. `isError` hid a stale title, but a status of error with `isError` still false did not.

**Fix:** `taskDetailPhase` in `apps/web/src/pages/task-detail-read.ts` reports `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Anything else is ready. `TaskDetailPage.tsx` uses that phase. Unread says the task has not arrived. Failed says Failed to load task and does not keep a stale title. A settled null payload stays missing. A settled list that does not contain the task stays missing. A task that arrived still shows, including a blank title.

**Why it works:** Missing is only for a payload that arrived. A missing payload is still in progress. A failure is not a settled miss and it is not the previous title.

**Prevention:** `TaskDetailPage.read.test.tsx` covers a paused read, an in-flight read with `isLoading` false, an in-flight read that used to be only a skeleton, a failed read, a failed read with a stale task, a failed status while `isError` is still false, a settled null payload, a settled list without the task, a loaded task, and a task with a blank title.
