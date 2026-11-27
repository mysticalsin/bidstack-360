# New lead access waits for the read

**Problem:** Opening a new lead runs before `GET /api/me/capabilities` returns. A paused read has `data === undefined` and `isLoading` false. The page said the person needs lead write access. An in-flight read said the same thing. A failed status with `isError` still false kept the create form.

**Diagnosis:** `useHasPermission` returns false when the manifest is missing, and it ignores `isError` when a stale manifest is still present. React Query can leave `data` undefined while `isLoading` is false, on a pause and on a slow read.

**Fix:** `newLeadAccessPhase` in `apps/web/src/pages/new-lead-access-read.ts` reports `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Anything else is ready. `NewLeadPage.tsx` uses that phase. Unread says lead access has not arrived. Failed says Could not check lead access and does not keep a stale grant. A settled null payload stays denied. A settled manifest without `leads:write` stays denied. A grant that arrived still shows the form, including a blank first name. An admin with an empty permission list still shows the form.

**Why it works:** Denial is only for a payload that arrived without a grant. A missing payload is still in progress. A failure is not a settled denial and it is not the previous grant.

**Prevention:** `NewLeadPage.read.test.tsx` covers a paused read, an in-flight read with `isLoading` false, an in-flight read that used to be only a denial, a failed read, a failed read with a stale grant, a failed status while `isError` is still false, a settled null payload, a settled manifest without the grant, a loaded grant, an admin with an empty permission list, and a form whose first name is blank.
