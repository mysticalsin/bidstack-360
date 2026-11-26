# MSA upload access waits for the read

**Problem:** The agreements dropzone opens before `GET /api/me/capabilities` returns. A paused read has `data === undefined` and `isLoading` false. The dropzone said the person can view agreements but not upload them. An in-flight read said the same thing. A failed status with `isError` still false kept the drop target when a stale grant was cached.

**Diagnosis:** `useHasPermission` returns false when the manifest is missing, and it ignores `isError` when a stale manifest is still present. React Query can leave `data` undefined while `isLoading` is false, on a pause and on a slow read. The agreements page also passes that same missing grant through as a disabled reason.

**Fix:** `intakeAccessPhase` in `apps/web/src/components/agreements/intake-access-read.ts` reports `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Anything else is ready. `IntakeDropzone.tsx` uses that phase. Unread says MSA upload access has not arrived. Failed says Could not check MSA upload access and does not keep a stale grant. A settled null payload stays denied. A settled manifest without `msa:write` stays denied. A grant that arrived still shows the drop target. An admin with an empty permission list still shows the drop target. A settled sample block stays on that reason.

**Why it works:** Denial is only for a payload that arrived without a grant, or for a settled reason the page already passed. A missing payload is still in progress. A failure is not a settled denial and it is not the previous grant.

**Prevention:** `IntakeDropzone.read.test.tsx` covers a paused read, an in-flight read with `isLoading` false, an in-flight read that used to be only a denial, a failed read, a failed read with a stale grant, a failed status while `isError` is still false, a settled null payload, a settled manifest without the grant, a loaded grant, an admin with an empty permission list, and a settled sample block.
