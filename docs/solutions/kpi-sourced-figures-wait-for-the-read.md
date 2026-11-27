# Sourced KPI figures wait for the read

Account metrics open before `GET /api/accounts/:id/key-numbers` returns. A paused or in-flight read has `data === undefined` and `isLoading` false. Revenue and headcount still showed the cockpit snapshot, including a missing label or a zero. A failed status with `isError` still false kept a stale sourced amount.

`kpiSourcedPhase` reports `unread`, `failed`, or `ready`. Error wins, then undefined data is unread, else the read is ready. Unread says the key numbers have not arrived and does not paint the snapshot, a zero, or a missing badge. Failed says "Could not load sourced figures." and drops a stale amount. A settled empty list, including a null payload, still shows the snapshot. A sourced figure that arrived still shows, including a settled zero and a blank source label. A company id that is not a uuid does not start this read, so the snapshot stays.

The override editor stays off a revenue or headcount card until that read is ready. Industry overrides, the internal caption, and the Apollo sync caption are unchanged.
