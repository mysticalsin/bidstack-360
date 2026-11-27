# Sample data status waits for the read

## Symptom

The sample-data banner hid while the status query was paused or still in flight. That is the same screen as a settled status of off. A failed read hid the same way. A failed refetch that still held a stale on payload kept saying sample data is on.

## Cause

The banner treated missing data as `hasSampleData: false`. React Query reports `isLoading: false` for a paused first read, so the pause fell through the loading check that was never there. `isError` was not read, so a failure also looked off, and a stale payload won over the error.

## Fix

Classify the read as unread, failed, or ready. Error wins, then undefined data is unread, else ready. Unread copy says the status has not arrived. Failed copy stays on the error. A settled false stays hidden. A settled true still shows the banner. The local store flag, set right after a template install, still shows the banner while the refetch is unread. It does not override a failed read.

## Verification

`SampleDataBanner.read.test.tsx` covers a paused read, an in-flight read, a failed read, a failed read with a stale on payload, a settled off status, and a settled on status.
